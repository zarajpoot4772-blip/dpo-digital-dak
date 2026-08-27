import { NextRequest, NextResponse } from 'next/server';
import { apiError, ipOf, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';
import { removeStoredFile, saveOriginal } from '@/lib/files';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let savedPaths: string[] = [];
  try {
    await mutationGuard(req);
    const user = await requireUser();
    const { id } = await params;
    const dakId = Number(id);
    if (!Number.isInteger(dakId) || dakId < 1) throw new Error('Invalid Dak id');
    const db = await getDb();
    const result = await db.query<any>('SELECT * FROM daks WHERE id=$1', [dakId]);
    const dak = result.rows[0];
    if (!dak) throw new Error('NOT_FOUND');
    if (['OFFICER'].includes(user.role) && dak.assigned_to !== user.id) throw new Error('FORBIDDEN');
    if (user.role === 'BRANCH_HEAD' && dak.branch !== user.branch && dak.assigned_to !== user.id) throw new Error('FORBIDDEN');
    if (['APPROVED', 'REJECTED', 'ARCHIVED'].includes(dak.status)) throw new Error('Finalized files cannot receive supporting documents');

    const form = await req.formData();
    const files = form.getAll('attachments').filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length) throw new Error('Select at least one supporting document');
    if (files.length > 10) throw new Error('A maximum of 10 supporting documents can be uploaded at once');
    if (files.reduce((total, file) => total + file.size, 0) > 200 * 1024 * 1024) throw new Error('Supporting documents exceed the 200 MB batch limit');

    const saved: Awaited<ReturnType<typeof saveOriginal>>[] = [];
    for (const file of files) {
      const item = await saveOriginal(file, dak.diary_number);
      saved.push(item);
      savedPaths.push(item.storedPath);
      if (item.converted) savedPaths.push(item.converted.storedPath);
    }

    const names = saved.map(item => item.original).join(', ').slice(0, 1000);
    const inserted = await db.transaction(async tx => {
      const ids: number[] = [];
      for (const item of saved) {
        const row = await tx.query<{ id: number }>(
          `INSERT INTO documents(dak_id,version_type,original_filename,stored_filename,file_type,file_size,sha256,search_text,uploaded_by)
           VALUES($1,'SUPPORTING',$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [dakId, item.original, item.stored, item.type, item.size, item.sha, item.searchText, user.id]
        );
        ids.push(row.rows[0].id);
        if (item.converted) {
          const convertedRow = await tx.query<{ id: number }>(
            `INSERT INTO documents(dak_id,version_type,original_filename,stored_filename,file_type,file_size,sha256,search_text,uploaded_by)
             VALUES($1,'SUPPORTING_CONVERTED',$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [dakId, item.converted.original, item.converted.stored, item.converted.type, item.converted.size, item.converted.sha, item.converted.searchText, user.id]
          );
          ids.push(convertedRow.rows[0].id);
        }
      }
      const note = String(form.get('remarks') || '').trim().slice(0, 2000);
      const auditText = `${note ? `${note} — ` : ''}Supporting document(s) uploaded: ${names}`;
      await tx.query(
        `INSERT INTO actions(dak_id,user_id,action,remarks,previous_status,new_status,ip,user_agent)
         VALUES($1,$2,'SUPPORTING_UPLOADED',$3,$4,$4,$5,$6)`,
        [dakId, user.id, auditText, dak.status, ipOf(req), req.headers.get('user-agent')?.slice(0, 300)]
      );
      if (dak.assigned_to && dak.assigned_to !== user.id) {
        await tx.query(
          `INSERT INTO notifications(user_id,dak_id,message) VALUES($1,$2,$3)`,
          [dak.assigned_to, dakId, `${user.name} added supporting document(s) to Dak ${dak.diary_number}.`]
        );
      }
      return ids;
    });
    savedPaths = [];
    await persistDb();
    return NextResponse.json({ ok: true, document_ids: inserted, count: saved.length, message: `${saved.length} supporting document(s) uploaded successfully` }, { status: 201 });
  } catch (error) {
    for (const filePath of savedPaths) await removeStoredFile(filePath);
    return apiError(error);
  }
}
