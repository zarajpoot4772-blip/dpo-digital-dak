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
    const dispatches = await db.query(
      `SELECT x.id,x.dispatch_number,x.dispatch_date,x.recipient,x.recipient_department,
              x.dispatch_mode,x.tracking_number,x.remarks,x.created_at,u.name,u.role
       FROM dispatches x JOIN users u ON u.id=x.created_by
       WHERE x.dak_id=$1 ORDER BY x.dispatch_date DESC,x.created_at DESC,x.id DESC`,
      [dakId]
    );
    return NextResponse.json({ dispatches: dispatches.rows });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await mutationGuard(req);
    const user = await requireUser(['ADMIN','DPO','CLERK']);
    const { id } = await params;
    const dakId = Number(id);
    if (!Number.isInteger(dakId) || dakId < 1) throw new Error('Invalid Dak id');
    const body = await req.json();
    const recipient = String(body.recipient || '').trim().slice(0, 200);
    const recipientDepartment = String(body.recipient_department || '').trim().slice(0, 150);
    const dispatchDate = String(body.dispatch_date || '').trim();
    const dispatchMode = String(body.dispatch_mode || 'COURIER').toUpperCase();
    const trackingNumber = String(body.tracking_number || '').trim().slice(0, 150);
    const remarks = String(body.remarks || '').trim().slice(0, 2000);
    if (!recipient) throw new Error('Dispatch recipient is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dispatchDate)) throw new Error('Valid dispatch date is required');
    if (!['POST','COURIER','EMAIL','HAND_DELIVERY'].includes(dispatchMode)) throw new Error('Invalid dispatch mode');
    const { db, dak } = await permittedDak(dakId, user);
    if (!['APPROVED','ARCHIVED'].includes(dak.status)) throw new Error('Dispatch can be registered only after approval');
    const dispatchNumber = (String(body.dispatch_number || '').trim() || `OUT-${dispatchDate.replaceAll('-','')}-${Date.now().toString(36).toUpperCase()}`).slice(0, 80);
    const auditRemarks = [`Dispatched to ${recipient}`, `via ${dispatchMode.replace('_',' ')}`, remarks].filter(Boolean).join(' — ');

    try {
      const result = await db.transaction(async tx => {
        const inserted = await tx.query<{ id: number }>(
          `INSERT INTO dispatches(dispatch_number,dak_id,dispatch_date,recipient,recipient_department,dispatch_mode,tracking_number,remarks,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [dispatchNumber,dakId,dispatchDate,recipient,recipientDepartment,dispatchMode,trackingNumber,remarks,user.id]
        );
        await tx.query(
          `INSERT INTO actions(dak_id,user_id,action,remarks,previous_status,new_status,ip,user_agent)
           VALUES($1,$2,'DISPATCH_CREATED',$3,$4,$4,$5,$6)`,
          [dakId,user.id,auditRemarks,dak.status,ipOf(req),req.headers.get('user-agent')?.slice(0,300)]
        );
        return inserted.rows[0].id;
      });
      await persistDb();
      return NextResponse.json({ ok: true, id: result, dispatch_number: dispatchNumber, message: 'Outward dispatch registered' }, { status: 201 });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.toLowerCase().includes('unique')) throw new Error('Dispatch number already exists');
      throw error;
    }
  } catch (error) {
    return apiError(error);
  }
}
