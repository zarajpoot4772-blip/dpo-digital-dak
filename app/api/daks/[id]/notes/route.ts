import { NextRequest, NextResponse } from 'next/server';
import { apiError, ipOf, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';

export const runtime = 'nodejs';

async function permittedDak(dakId: number, user: Awaited<ReturnType<typeof requireUser>>) {
  const db = await getDb();
  const result = await db.query<any>('SELECT * FROM daks WHERE id=$1', [dakId]);
  const dak = result.rows[0];
  if (!dak) throw new Error('NOT_FOUND');
  if (user.role === 'OFFICER' && dak.assigned_to !== user.id) throw new Error('FORBIDDEN');
  if (user.role === 'BRANCH_HEAD' && dak.branch !== user.branch && dak.assigned_to !== user.id) throw new Error('FORBIDDEN');
  return { db, dak };
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const dakId = Number(id);
    if (!Number.isInteger(dakId) || dakId < 1) throw new Error('Invalid Dak id');
    const { db } = await permittedDak(dakId, user);
    const notes = await db.query(
      `SELECT n.id,n.body,n.created_at,u.name,u.role
       FROM file_notes n JOIN users u ON u.id=n.user_id
       WHERE n.dak_id=$1 ORDER BY n.created_at DESC,n.id DESC`,
      [dakId]
    );
    return NextResponse.json({ notes: notes.rows });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await mutationGuard(req);
    const user = await requireUser();
    const { id } = await params;
    const dakId = Number(id);
    if (!Number.isInteger(dakId) || dakId < 1) throw new Error('Invalid Dak id');
    const body = await req.json();
    const note = String(body.body || body.note || '').trim();
    if (!note) throw new Error('Internal note cannot be empty');
    if (note.length > 2000) throw new Error('Internal note is too long (maximum 2000 characters)');
    const { db, dak } = await permittedDak(dakId, user);
    if (['APPROVED','REJECTED','ARCHIVED'].includes(dak.status)) throw new Error('Finalized files cannot receive internal notes');

    const result = await db.transaction(async tx => {
      const inserted = await tx.query<{ id: number }>(
        `INSERT INTO file_notes(dak_id,user_id,body) VALUES($1,$2,$3) RETURNING id`,
        [dakId, user.id, note]
      );
      await tx.query(
        `INSERT INTO actions(dak_id,user_id,action,remarks,previous_status,new_status,ip,user_agent)
         VALUES($1,$2,'NOTE_ADDED',$3,$4,$4,$5,$6)`,
        [dakId, user.id, note, dak.status, ipOf(req), req.headers.get('user-agent')?.slice(0, 300)]
      );
      return inserted.rows[0].id;
    });
    await persistDb();
    return NextResponse.json({ ok: true, id: result, message: 'Internal note added' }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
