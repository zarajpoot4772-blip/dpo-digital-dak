import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { apiError, ipOf, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';
import { removeStoredFile, saveOriginal } from '@/lib/files';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const db = await getDb();
    const q = (req.nextUrl.searchParams.get('q') || '').slice(0, 150);
    const status = req.nextUrl.searchParams.get('status') || '';
    const priority = req.nextUrl.searchParams.get('priority') || '';
    const args: unknown[] = [];
    const where: string[] = [];

    if (user.role === 'OFFICER') {
      args.push(user.id);
      where.push(`d.assigned_to=$${args.length}`);
    } else if (user.role === 'BRANCH_HEAD') {
      args.push(user.branch);
      const branchParam = args.length;
      args.push(user.id);
      where.push(`(d.branch=$${branchParam} OR d.assigned_to=$${args.length})`);
    }
    if (q) {
      args.push(`%${q}%`);
      where.push(`(d.diary_number ILIKE $${args.length} OR d.subject ILIKE $${args.length} OR d.sender ILIKE $${args.length} OR d.letter_number ILIKE $${args.length} OR EXISTS (SELECT 1 FROM documents sd WHERE sd.dak_id=d.id AND sd.search_text ILIKE $${args.length}))`);
    }
    if (status) {
      if (status === 'PENDING') where.push(`d.status IN ('PENDING','OPENED','RETURNED')`);
      else if (['FORWARDED','APPROVED','REJECTED','ARCHIVED','RETURNED','CORRECTION_REQUIRED'].includes(status)) {
        args.push(status);
        where.push(`d.status=$${args.length}`);
      }
    }
    if (['NORMAL','HIGH','URGENT'].includes(priority)) {
      args.push(priority);
      where.push(`d.priority=$${args.length}`);
    }
    const branch = (req.nextUrl.searchParams.get('branch') || '').trim().slice(0, 120);
    const dateFrom = (req.nextUrl.searchParams.get('date_from') || '').trim();
    const dateTo = (req.nextUrl.searchParams.get('date_to') || '').trim();
    const dueFrom = (req.nextUrl.searchParams.get('due_from') || '').trim();
    const dueTo = (req.nextUrl.searchParams.get('due_to') || '').trim();
    const confidentiality = (req.nextUrl.searchParams.get('confidentiality') || '').trim();
    const assignedTo = Number(req.nextUrl.searchParams.get('assigned_to') || 0);
    if (branch) { args.push(branch); where.push(`d.branch=$${args.length}`); }
    if (dateFrom) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) throw new Error('Invalid start date');
      args.push(dateFrom); where.push(`d.received_date >= $${args.length}`);
    }
    if (dateTo) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) throw new Error('Invalid end date');
      args.push(dateTo); where.push(`d.received_date <= $${args.length}`);
    }
    if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('Start date must not be after end date');
    if (dueFrom) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueFrom)) throw new Error('Invalid due-date start');
      args.push(dueFrom); where.push(`d.due_date >= $${args.length}`);
    }
    if (dueTo) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueTo)) throw new Error('Invalid due-date end');
      args.push(dueTo); where.push(`d.due_date <= $${args.length}`);
    }
    if (dueFrom && dueTo && dueFrom > dueTo) throw new Error('Due-date start must not be after end date');
    if (confidentiality && ['OFFICIAL','RESTRICTED','CONFIDENTIAL'].includes(confidentiality)) {
      args.push(confidentiality); where.push(`d.confidentiality=$${args.length}`);
    }
    if (assignedTo > 0 && Number.isInteger(assignedTo)) {
      args.push(assignedTo); where.push(`d.assigned_to=$${args.length}`);
    }

    const result = await db.query(
      `SELECT d.id,d.diary_number,d.diary_date,d.received_date,d.due_date,d.subject,d.sender,d.letter_number,
       d.department,d.branch,d.priority,d.confidentiality,d.status,d.updated_at,u.name assigned_name,
       (SELECT max(created_at) FROM actions WHERE dak_id=d.id) last_action_at
       FROM daks d LEFT JOIN users u ON u.id=d.assigned_to
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY CASE d.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,d.updated_at DESC LIMIT 200`, args
    );
    return NextResponse.json({ items: result.rows });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  let savedPaths: string[] = [];
  try {
    await mutationGuard(req);
    const user = await requireUser(['ADMIN', 'CLERK', 'BRANCH_HEAD']);
    if (!req.headers.get('content-type')?.toLowerCase().includes('multipart/form-data')) throw new Error('Invalid Dak upload form');
    const form = await req.formData();
    const get = (key: string) => String(form.get(key) || '').trim();
    const file = form.get('attachment');
    const uploadedSubject = file instanceof File && file.size>0 ? file.name.replace(/\.[^.]+$/,'').trim() : '';
    const now = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    const currentTime = `${parts.hour}:${parts.minute}`;
    const diaryNumber = (get('diary_number') || `AUTO-${today.replaceAll('-','')}-${now.getTime().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`).slice(0,80);
    const diaryDate = get('diary_date') || today;
    const receivedDate = get('received_date') || today;
    const receivedTime = get('received_time') || currentTime;
    const dueDate = get('due_date');
    const subject = (get('subject') || uploadedSubject || 'Untitled Dak').slice(0,500);
    const branch = user.branch || 'Unassigned Branch';
    const department = user.department || 'DPO Office';
    const sender = branch;
    const letterDate = get('letter_date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(diaryDate) || !/^\d{4}-\d{2}-\d{2}$/.test(receivedDate) || (letterDate&&!/^\d{4}-\d{2}-\d{2}$/.test(letterDate)) || (dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) throw new Error('Invalid date');
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(receivedTime)) throw new Error('Invalid received time');
    const priority = get('priority') || 'NORMAL';
    const confidentiality = get('confidentiality') || 'OFFICIAL';
    if (!['NORMAL','HIGH','URGENT'].includes(priority)) throw new Error('Invalid priority');
    if (!['OFFICIAL','RESTRICTED','CONFIDENTIAL'].includes(confidentiality)) throw new Error('Invalid confidentiality level');

    const db = await getDb();
    const duplicate = await db.query(`SELECT 1 FROM daks WHERE diary_number=$1`, [diaryNumber]);
    if (duplicate.rows.length) throw new Error('CONFLICT');

    let assignedTo = Number(get('assigned_to'));
    if (!assignedTo || user.role === 'BRANCH_HEAD') {
      const dpo = await db.query<{ id: number }>(`SELECT id FROM users WHERE role='DPO' AND active=true ORDER BY id LIMIT 1`);
      if (!dpo.rows[0]) throw new Error('No active DPO account is available');
      assignedTo = dpo.rows[0].id;
    } else {
      const recipient = await db.query(`SELECT 1 FROM users WHERE id=$1 AND active=true AND role IN ('DPO','OFFICER')`, [assignedTo]);
      if (!recipient.rows.length) throw new Error('Invalid assigned officer');
    }

    let saved: Awaited<ReturnType<typeof saveOriginal>> | null = null;
    const duplicateOverride = get('allow_duplicate') === 'true';
    if (file instanceof File && file.size > 0) {
      saved = await saveOriginal(file, diaryNumber);
      savedPaths.push(saved.storedPath);
      if(saved.converted)savedPaths.push(saved.converted.storedPath);
      const duplicate = await db.query<{ diary_number: string }>(
        `SELECT d.diary_number
         FROM documents existing JOIN daks d ON d.id=existing.dak_id
         WHERE existing.sha256=$1
           AND existing.version_type IN ('ORIGINAL','CONVERTED','SUPPORTING','SUPPORTING_CONVERTED')
         ORDER BY existing.id LIMIT 1`,
        [saved.sha]
      );
      if (duplicate.rows[0] && !duplicateOverride) throw new Error(`Duplicate document detected; it already exists under Dak ${duplicate.rows[0].diary_number}`);
    }

    const auditRemarks = `${get('remarks') || (saved?.converted?'DOCX original preserved and PDF preview generated':saved?'Dak entered and original uploaded':'Dak entered without an attachment')}${duplicateOverride ? ' — Duplicate upload explicitly confirmed by uploader.' : ''}`.slice(0, 2000);
    const dakId = await db.transaction(async tx => {
      const dak = await tx.query<{ id: number }>(
        `INSERT INTO daks(diary_number,diary_date,received_date,received_time,due_date,subject,sender,letter_number,letter_date,department,branch,priority,confidentiality,status,assigned_to,created_by,remarks)
         VALUES($1,$2,$3,$4,nullif($5,'')::date,$6,$7,$8,nullif($9,'')::date,$10,$11,$12,$13,'PENDING',$14,$15,$16) RETURNING id`,
        [diaryNumber,diaryDate,receivedDate,receivedTime,dueDate,subject,sender,get('letter_number'),letterDate,department,branch,priority,confidentiality,assignedTo,user.id,get('remarks')]
      );
      const id = dak.rows[0].id;
      if (saved) await tx.query(
        `INSERT INTO documents(dak_id,version_type,original_filename,stored_filename,file_type,file_size,sha256,search_text,text_indexed,uploaded_by)
         VALUES($1,'ORIGINAL',$2,$3,$4,$5,$6,$7,true,$8)`,
        [id,saved.original,saved.stored,saved.type,saved.size,saved.sha,saved.searchText,user.id]
      );
      if(saved?.converted)await tx.query(
        `INSERT INTO documents(dak_id,version_type,original_filename,stored_filename,file_type,file_size,sha256,search_text,text_indexed,uploaded_by)
         VALUES($1,'CONVERTED',$2,$3,$4,$5,$6,$7,true,$8)`,
        [id,saved.converted.original,saved.converted.stored,saved.converted.type,saved.converted.size,saved.converted.sha,saved.converted.searchText,user.id]
      );
      await tx.query(
        `INSERT INTO actions(dak_id,user_id,action,remarks,previous_status,new_status,ip,user_agent)
         VALUES($1,$2,'CREATED',$3,NULL,'PENDING',$4,$5)`,
        [id,user.id,auditRemarks,ipOf(req),req.headers.get('user-agent')?.slice(0,300)]
      );
      await tx.query(`INSERT INTO notifications(user_id,dak_id,message) VALUES($1,$2,$3)`, [assignedTo,id,`New Dak ${diaryNumber} is pending for review.`]);
      return id;
    });

    savedPaths = [];
    await persistDb();
    return NextResponse.json({ id: dakId, diary_number: diaryNumber, has_attachment: !!saved }, { status: 201 });
  } catch (error: unknown) {
    for(const filePath of savedPaths)await removeStoredFile(filePath);
    if (error instanceof Error && error.message.toLowerCase().includes('unique')) return apiError(new Error('CONFLICT'));
    return apiError(error);
  }
}
