import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { apiError, ipOf, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';
import { storagePath, watermarkedDocument } from '@/lib/files';

export const runtime = 'nodejs';

const exportRoles = new Set(['ADMIN', 'DPO', 'CLERK']);
const accessModes = new Set(['preview', 'download', 'print', 'source']);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = (req.nextUrl.searchParams.get('access') || 'preview').toLowerCase();
    if (!accessModes.has(access)) throw new Error('Unsupported document access mode');
    const user = await requireUser(undefined, req.nextUrl.searchParams.get('preview_token'));
    const { id } = await params;
    const documentId = Number(id);
    const db = await getDb();
    const result = await db.query<any>(
      `SELECT doc.*,d.assigned_to,d.created_by,d.branch,d.status AS dak_status
       FROM documents doc JOIN daks d ON d.id=doc.dak_id WHERE doc.id=$1`,
      [documentId]
    );
    const doc = result.rows[0];
    if (!doc) throw new Error('NOT_FOUND');
    if (user.role === 'OFFICER' && doc.assigned_to !== user.id) throw new Error('FORBIDDEN');
    if (user.role === 'BRANCH_HEAD' && doc.branch !== user.branch && doc.assigned_to !== user.id) throw new Error('FORBIDDEN');
    if (access === 'source' && !['ADMIN', 'DPO'].includes(user.role)) throw new Error('FORBIDDEN');
    if (['download', 'print'].includes(access) && !exportRoles.has(user.role)) {
      throw new Error('FORBIDDEN');
    }

    const originalPath = storagePath(doc.version_type, doc.stored_filename);
    let bytes = await fs.readFile(originalPath);
    let contentType = doc.file_type;
    let filename = String(doc.original_filename).replace(/["\r\n]/g, '') || 'document';
    let watermarked = false;
    const canRenderWatermark = doc.file_type === 'application/pdf' || doc.file_type === 'image/png' || doc.file_type === 'image/jpeg';
    if (access !== 'source' && canRenderWatermark) {
      const classification = String(doc.confidentiality || 'OFFICIAL');
      const label = `DPO DIGITAL DAK · ${classification} · ${user.role} · ${user.name}`;
      bytes = await watermarkedDocument(originalPath, doc.file_type, label);
      contentType = 'application/pdf';
      filename = filename.replace(/\.(pdf|png|jpe?g)$/i, '') + '-controlled-copy.pdf';
      watermarked = true;
    }

    if (access === 'download' || access === 'print') {
      await db.query(
        `INSERT INTO actions(dak_id,user_id,action,remarks,previous_status,new_status,ip,user_agent)
         VALUES($1,$2,$3,$4,$5,$5,$6,$7)`,
        [doc.dak_id, user.id, access === 'download' ? 'DOCUMENT_DOWNLOADED' : 'DOCUMENT_PRINT_OPENED', `${doc.version_type}: ${doc.original_filename}`.slice(0, 1000), doc.dak_status, ipOf(req), req.headers.get('user-agent')?.slice(0, 300)]
      );
      await persistDb();
    }

    return new NextResponse(bytes, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `${access === 'download' ? 'attachment' : 'inline'}; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Document-SHA256': doc.sha256,
        'X-Watermarked-Copy': String(watermarked)
      }
    });
  } catch (error) {
    return apiError(error);
  }
}
