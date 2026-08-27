import { NextRequest, NextResponse } from 'next/server';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';
import { indexExistingDocumentText } from '@/lib/document-text';

declare global {
  var __dpoReindexJob: Promise<any> | undefined;
  var __dpoReindexResult: any;
}

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    await requireUser(['ADMIN']);
    if (process.env.PGLITE_MEMORY === '1') throw new Error('OCR rebuild is disabled in temporary preview mode. Use the local or live website.');
    if (global.__dpoReindexJob) {
      return NextResponse.json({ ok: true, running: true, message: 'Document OCR rebuild is already running in the background' });
    }
    const db = await getDb();
    global.__dpoReindexJob = (async () => {
      try {
        const result = await indexExistingDocumentText(db, true);
        await persistDb();
        global.__dpoReindexResult = result;
        return result;
      } catch (error) {
        global.__dpoReindexResult = { indexed: 0, failed: 1, total: 0, error: error instanceof Error ? error.message : 'OCR rebuild failed' };
        console.error('DOCUMENT_TEXT_REBUILD_ERROR', error);
        throw error;
      } finally {
        global.__dpoReindexJob = undefined;
      }
    })();
    return NextResponse.json({ ok: true, running: true, message: 'Document OCR rebuild started in the background. Search again after it finishes.' });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET() {
  try {
    await requireUser(['ADMIN']);
    return NextResponse.json({ ok: true, running: Boolean(global.__dpoReindexJob), last_result: global.__dpoReindexResult || null });
  } catch (error) {
    return apiError(error);
  }
}
