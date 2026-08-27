import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { apiError, requireUser } from '@/lib/auth';
import { backupDirectory } from '@/lib/backup';

export const runtime = 'nodejs';

export async function GET(_: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    await requireUser(['ADMIN']);
    const { name: encodedName } = await params;
    const name = decodeURIComponent(encodedName);
    if (!/^[a-z0-9-]+\.zip$/i.test(name)) throw new Error('Invalid backup filename');
    const bytes = await fs.readFile(path.join(backupDirectory, name));
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    return apiError(error);
  }
}
