import { NextResponse } from 'next/server';
import { apiError, requireUser } from '@/lib/auth';
import { listBackupFiles } from '@/lib/backup';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireUser(['ADMIN']);
    return NextResponse.json({ items: await listBackupFiles() });
  } catch (error) {
    return apiError(error);
  }
}
