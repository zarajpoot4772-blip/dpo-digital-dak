import { NextRequest, NextResponse } from 'next/server';
import { apiError, ipOf, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const dakId = Number(id);
    if (!Number.isInteger(dakId) || dakId < 1) throw new Error('Invalid Dak id');
    const db = await getDb();
    const result = await db.query(
      `SELECT d.*,a.name assigned_name,c.name created_name
       FROM daks d LEFT JOIN users a ON a.id=d.assigned_to LEFT JOIN users c ON c.id=d.created_by
       WHERE d.id=$1`,
      [dakId]
    );
    if (!result.rows[0]) throw new Error('NOT_FOUND');
    const dak: any = result.rows[0];
    if (user.role === 'OFFICER' && dak.assigned_to !== user.id) throw new Error('FORBIDDEN');
    if (user.role === 'BRANCH_HEAD' && dak.branch !== user.branch && dak.assigned_to !== user.id) throw new Error('FORBIDDEN');
    const docs = await db.query(`SELECT id,version_type,original_filename,file_type,file_size,sha256,uploaded_at FROM documents WHERE dak_id=$1 ORDER BY uploaded_at`, [dakId]);
    const actions = await db.query(
      `SELECT a.id,a.action,a.remarks,a.previous_status,a.new_status,a.created_at,u.name,u.role,t.name to_name
       FROM actions a JOIN users u ON u.id=a.user_id LEFT JOIN users t ON t.id=a.to_user_id
       WHERE a.dak_id=$1 ORDER BY a.created_at DESC`,
      [dakId]
    );
    return NextResponse.json({ dak, documents: docs.rows, actions: actions.rows });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await mutationGuard(req);
    const user = await requireUser(['ADMIN', 'CLERK', 'DPO']);
    const { id } = await params;
    const dakId = Number(id);
    if (!Number.isInteger(dakId) || dakId < 1) throw new Error('Invalid Dak id');
    const body = await req.json();
    const subject = String(body.subject || '').trim().slice(0, 500);
    const letterNumber = String(body.letter_number || '').trim().slice(0, 180);
    const letterDate = String(body.letter_date || '').trim();
    const dueDate = String(body.due_date || '').trim();
    const priority = String(body.priority || '').toUpperCase();
    const confidentiality = String(body.confidentiality || '').toUpperCase();
    if (!subject) throw new Error('Subject cannot be empty');
    if (letterDate && !/^\d{4}-\d{2}-\d{2}$/.test(letterDate)) throw new Error('Invalid letter date');
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('Invalid due date');
    if (!['NORMAL', 'HIGH', 'URGENT'].includes(priority)) throw new Error('Invalid priority');
    if (!['OFFICIAL', 'RESTRICTED', 'CONFIDENTIAL'].includes(confidentiality)) throw new Error('Invalid confidentiality level');

    const db = await getDb();
    const current = await db.query<any>('SELECT * FROM daks WHERE id=$1', [dakId]);
    const dak = current.rows[0];
    if (!dak) throw new Error('NOT_FOUND');
    if (['APPROVED', 'REJECTED', 'ARCHIVED'].includes(dak.status)) throw new Error('Finalized files cannot be edited');
    await db.query(
      `UPDATE daks SET subject=$1,letter_number=$2,letter_date=nullif($3,'')::date,due_date=nullif($4,'')::date,priority=$5,confidentiality=$6,updated_at=now()
       WHERE id=$7`,
      [subject, letterNumber, letterDate, dueDate, priority, confidentiality, dakId]
    );
    const changed = [
      dak.subject !== subject ? 'subject' : '',
      (dak.letter_number || '') !== letterNumber ? 'letter number' : '',
      String(dak.letter_date || '').slice(0, 10) !== letterDate ? 'letter date' : '',
      String(dak.due_date || '').slice(0, 10) !== dueDate ? 'due date' : '',
      dak.priority !== priority ? 'priority' : '',
      dak.confidentiality !== confidentiality ? 'confidentiality' : ''
    ].filter(Boolean).join(', ') || 'no visible field';
    await db.query(
      `INSERT INTO actions(dak_id,user_id,action,remarks,previous_status,new_status,ip,user_agent)
       VALUES($1,$2,'METADATA_UPDATED',$3,$4,$4,$5,$6)`,
      [dakId, user.id, `Updated ${changed}`, dak.status, ipOf(req), req.headers.get('user-agent')?.slice(0, 300)]
    );
    if (dak.assigned_to && dak.assigned_to !== user.id) {
      await db.query(
        `INSERT INTO notifications(user_id,dak_id,message) VALUES($1,$2,$3)`,
        [dak.assigned_to, dakId, `${user.name} updated the metadata of Dak ${dak.diary_number}.`]
      );
    }
    await persistDb();
    return NextResponse.json({ ok: true, message: 'Dak details updated successfully' });
  } catch (error) {
    return apiError(error);
  }
}
