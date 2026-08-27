import { NextRequest, NextResponse } from 'next/server';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';
import { indexExistingDocumentText } from '@/lib/document-text';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    await requireUser(['ADMIN']);
    const result = await indexExistingDocumentText(await getDb(), true);
    await persistDb();
    return NextResponse.json({ ok: true, ...result, message: `${result.indexed} document(s) indexed${result.failed ? `; ${result.failed} failed` : ''}` });
  } catch (error) {
    return apiError(error);
  }
}
