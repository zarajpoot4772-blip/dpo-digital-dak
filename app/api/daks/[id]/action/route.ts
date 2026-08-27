import { NextRequest, NextResponse } from 'next/server';
import { apiError, ipOf, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';
import { approvedPdf, signatureStoragePath, storagePath } from '@/lib/files';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await mutationGuard(req);
    const user = await requireUser();
    const { id } = await params;
    const dakId = Number(id);
    const body = await req.json();
    const action = String(body.action || '').toUpperCase();
    const remarks = String(body.remarks || '').trim();
    const db = await getDb();
    const result = await db.query<any>('SELECT * FROM daks WHERE id=$1', [dakId]);
    const dak = result.rows[0];
    if (!dak) throw new Error('NOT_FOUND');

    if (user.role === 'OFFICER' && dak.assigned_to !== user.id) throw new Error('FORBIDDEN');
    if (user.role === 'BRANCH_HEAD' && ((dak.branch !== user.branch && dak.assigned_to !== user.id) || !['REMARK','SEND_BACK'].includes(action))) {
      throw new Error('FORBIDDEN');
    }

    let nextStatus = dak.status;
    let recipientId: number | null = null;

    if (action === 'OPEN') {
      if (!['DPO', 'OFFICER'].includes(user.role) || dak.assigned_to !== user.id) throw new Error('FORBIDDEN');
      if (!['PENDING','RETURNED'].includes(dak.status)) return NextResponse.json({ ok: true, status: dak.status });
      nextStatus = 'OPENED';
    } else if (action === 'APPROVE') {
      if (user.role !== 'DPO') throw new Error('FORBIDDEN');
      if (['APPROVED', 'REJECTED', 'ARCHIVED'].includes(dak.status)) throw new Error('This file is already finalized');

      const document = await db.query<any>(
        `SELECT * FROM documents
         WHERE dak_id=$1 AND version_type IN ('CONVERTED','ORIGINAL')
         ORDER BY CASE version_type WHEN 'CONVERTED' THEN 0 ELSE 1 END,id LIMIT 1`,
        [dakId]
      );
      if (!document.rows[0]) throw new Error('Original document not found');

      const approvalMode = String(body.signature_mode || 'SIGNATURE_ONLY').toUpperCase();
      if (!['SIGNATURE_ONLY', 'STAMP_ONLY'].includes(approvalMode)) throw new Error('Choose Signature only or Official stamp only');

      const configuredAsset = await db.query<any>(
        `SELECT stored_filename FROM user_signatures
         WHERE user_id=$1 AND asset_type=$2 AND active=true
         ORDER BY id DESC LIMIT 1`,
        [user.id, approvalMode === 'SIGNATURE_ONLY' ? 'SIGNATURE' : 'STAMP']
      );
      if (!configuredAsset.rows[0]) {
        throw new Error(approvalMode === 'SIGNATURE_ONLY'
          ? 'DPO signature is not configured. Ask Admin to upload it first'
          : 'DPO official stamp is not configured. Ask Admin to upload it first');
      }

      const signaturePage = Number(body.signature_page);
      const signatureX = Number(body.signature_x);
      const signatureY = Number(body.signature_y);
      if (!Number.isInteger(signaturePage) || signaturePage < 1) throw new Error('Valid approval page is required');
      if (!Number.isFinite(signatureX) || !Number.isFinite(signatureY) || signatureX < 0 || signatureX > 1 || signatureY < 0 || signatureY > 1) {
        throw new Error('Valid approval position is required');
      }

      const reference = `DPO-APR-${new Date().getFullYear()}-${String(dakId).padStart(6, '0')}`;
      const filename = `DAAK-${String(dak.diary_number).replace(/[^a-zA-Z0-9-]/g, '-')}-approved-${Date.now()}.pdf`;
      const output = storagePath('APPROVED', filename);
      let stamped;
      try {
        stamped = await approvedPdf(
          storagePath(document.rows[0].version_type, document.rows[0].stored_filename),
          document.rows[0].file_type,
          output,
          {
            signaturePath: approvalMode === 'SIGNATURE_ONLY' ? signatureStoragePath(configuredAsset.rows[0].stored_filename) : undefined,
            stampPath: approvalMode === 'STAMP_ONLY' ? signatureStoragePath(configuredAsset.rows[0].stored_filename) : undefined,
            remarks,
            page: signaturePage,
            x: signatureX,
            y: signatureY
          }
        );
      } catch (error) {
        console.error('APPROVAL_PDF_ERROR', error);
        throw new Error('Approval PDF could not be generated. Please verify the document and selected approval asset');
      }

      const inserted = await db.query<{ id: number }>(
        `INSERT INTO documents(dak_id,version_type,original_filename,stored_filename,file_type,file_size,sha256,uploaded_by)
         VALUES($1,'APPROVED',$2,$3,'application/pdf',$4,$5,$6) RETURNING id`,
        [dakId, `DAAK-${dak.diary_number}-approved.pdf`, filename, stamped.size, stamped.sha, user.id]
      );
      await db.query(
        `INSERT INTO signatures(dak_id,signed_by,signature_method,signed_document,reference_number)
         VALUES($1,$2,$3,$4,$5)`,
        [dakId, user.id, approvalMode, inserted.rows[0].id, reference]
      );
      nextStatus = 'APPROVED';
    } else if (action === 'REJECT') {
      if (user.role !== 'DPO') throw new Error('FORBIDDEN');
      if (['APPROVED', 'REJECTED', 'ARCHIVED'].includes(dak.status)) throw new Error('This file is already finalized');
      nextStatus = 'REJECTED';
    } else if (action === 'FORWARD') {
      if (!['DPO', 'OFFICER', 'ADMIN'].includes(user.role)) throw new Error('FORBIDDEN');
      if (['APPROVED', 'REJECTED', 'ARCHIVED'].includes(dak.status)) throw new Error('Finalized files cannot be forwarded');
      recipientId = Number(body.to_user_id);
      if (!recipientId || recipientId === user.id) throw new Error('A different forward recipient is required');
      const recipient = await db.query<any>(
        `SELECT id,name FROM users WHERE id=$1 AND active=true AND role IN ('DPO','OFFICER','BRANCH_HEAD')`,
        [recipientId]
      );
      if (!recipient.rows[0]) throw new Error('Recipient not found or not eligible');
      nextStatus = 'FORWARDED';
      await db.query(
        `INSERT INTO notifications(user_id,dak_id,message) VALUES($1,$2,$3)`,
        [recipientId, dakId, `Dak ${dak.diary_number} was forwarded to you by ${user.name}.`]
      );
    } else if (action === 'REASSIGN') {
      if (!['DPO','ADMIN'].includes(user.role)) throw new Error('FORBIDDEN');
      if (['APPROVED','REJECTED','ARCHIVED'].includes(dak.status)) throw new Error('Finalized files cannot be reassigned');
      recipientId = Number(body.to_user_id);
      if (!recipientId || recipientId === user.id) throw new Error('A different reassignment recipient is required');
      const recipient = await db.query<any>(
        `SELECT id,name FROM users WHERE id=$1 AND active=true AND role IN ('DPO','OFFICER','CLERK','BRANCH_HEAD')`,
        [recipientId]
      );
      if (!recipient.rows[0]) throw new Error('Reassignment recipient not found or not eligible');
      nextStatus = 'FORWARDED';
      await db.query(
        `INSERT INTO notifications(user_id,dak_id,message) VALUES($1,$2,$3)`,
        [recipientId, dakId, `Dak ${dak.diary_number} was reassigned to you by ${user.name}.`]
      );
    } else if (action === 'SEND_BACK') {
      if (!['OFFICER','BRANCH_HEAD'].includes(user.role)) throw new Error('FORBIDDEN');
      if (['APPROVED','REJECTED','ARCHIVED'].includes(dak.status)) throw new Error('Finalized files cannot be sent back');
      const dpo = await db.query<{id:number;name:string}>(`SELECT id,name FROM users WHERE role='DPO' AND active=true ORDER BY id LIMIT 1`);
      if (!dpo.rows[0]) throw new Error('No active DPO account is available');
      recipientId = dpo.rows[0].id;
      nextStatus = 'RETURNED';
      await db.query(
        `INSERT INTO notifications(user_id,dak_id,message) VALUES($1,$2,$3)`,
        [recipientId, dakId, `Dak ${dak.diary_number} was sent back by ${user.name}.`]
      );
    } else if (action === 'REMARK') {
      if (!remarks) throw new Error('Remarks cannot be empty');
    } else if (action === 'ARCHIVE') {
      if (user.role !== 'ADMIN') throw new Error('FORBIDDEN');
      if (!['APPROVED', 'REJECTED'].includes(dak.status)) throw new Error('Only finalized files can be archived');
      nextStatus = 'ARCHIVED';
    } else {
      throw new Error('Unsupported action');
    }

    await db.query(
      `UPDATE daks SET status=$1,assigned_to=coalesce($2,assigned_to),updated_at=now(),
       opened_at=CASE WHEN $1='OPENED' THEN coalesce(opened_at,now()) ELSE opened_at END,
       archived_at=CASE WHEN $1='ARCHIVED' THEN now() ELSE archived_at END
       WHERE id=$3`,
      [nextStatus, recipientId, dakId]
    );
    await db.query(
      `INSERT INTO actions(dak_id,user_id,action,remarks,previous_status,new_status,to_user_id,ip,user_agent)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [dakId, user.id, action, remarks, dak.status, nextStatus, recipientId, ipOf(req), req.headers.get('user-agent')]
    );

    if (['APPROVED', 'REJECTED'].includes(nextStatus)) {
      await db.query(
        `INSERT INTO notifications(user_id,dak_id,message)
         SELECT created_by,$1,$2 FROM daks WHERE id=$1`,
        [dakId, `Dak ${dak.diary_number} was ${nextStatus.toLowerCase()} by ${user.name}.`]
      );
    }

    await persistDb();
    return NextResponse.json({ ok: true, status: nextStatus });
  } catch (error) {
    return apiError(error);
  }
}
