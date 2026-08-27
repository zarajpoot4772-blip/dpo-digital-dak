import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { closeDb } from '@/lib/db';
import { createBackupBytes, restoreBackupBytes } from '@/lib/backup';
import { runtimeRoot } from '@/lib/runtime-paths';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireUser(['ADMIN']);
    const bytes = await createBackupBytes();
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="dpo-digital-dak-backup-${date}.zip"`,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    await requireUser(['ADMIN']);
    if (process.env.PGLITE_MEMORY === '1') throw new Error('Restore is disabled in temporary preview mode. Use the local or live website.');
    const form = await req.formData();
    const file = form.get('backup');
    if (!(file instanceof File)) throw new Error('Backup ZIP is required');
    if (file.size < 1 || file.size > 300 * 1024 * 1024) throw new Error('Backup ZIP must be between 1 byte and 300 MB');

    // Always keep a server-side safety copy before replacing the active runtime.
    const safety = await createBackupBytes();
    const backupDirectory = path.join(runtimeRoot, 'backups');
    await fs.mkdir(backupDirectory, { recursive: true });
    const safetyPath = path.join(backupDirectory, `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.zip`);
    await fs.writeFile(safetyPath, safety, { flag: 'wx' });

    const bytes = new Uint8Array(await file.arrayBuffer());
    await closeDb();
    const result = await restoreBackupBytes(bytes);
    return NextResponse.json({ ok: true, ...result, message: 'Backup restored successfully. The workspace will reload.' });
  } catch (error) {
    return apiError(error);
  }
}
