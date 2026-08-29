import { NextRequest, NextResponse } from 'next/server';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

const SHA256 = /^[a-f0-9]{64}$/i;

/**
 * Check a selected upload batch before any Dak record or file is created.
 * The final duplicate check remains in the upload route as a race-condition
 * and API-tampering safeguard; this endpoint only makes the user decision
 * possible before the upload starts.
 */
export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    await requireUser();
    const body = await req.json();
    if (!Array.isArray(body?.hashes)) throw new Error('Invalid duplicate check request');

    const rawHashes: unknown[] = body.hashes;
    const hashes = [...new Set(rawHashes.filter((value: unknown): value is string => typeof value === 'string').map((value: string) => value.trim().toLowerCase()))];
    if (hashes.length > 50) throw new Error('A maximum of 50 files can be checked at once');
    if (hashes.some(hash => !SHA256.test(hash))) throw new Error('Invalid file hash');
    if (!hashes.length) return NextResponse.json({ matches: [] });

    const db = await getDb();
    const placeholders = hashes.map((_, index) => `$${index + 1}`).join(',');
    const result = await db.query<{
      sha256: string;
      dak_id: number;
      diary_number: string;
      subject: string;
      received_date: string;
      status: string;
      original_filename: string;
      version_type: string;
    }>(
      `SELECT existing.sha256,existing.dak_id,d.diary_number,d.subject,d.received_date,d.status,
              existing.original_filename,existing.version_type
       FROM documents existing
       JOIN daks d ON d.id=existing.dak_id
       WHERE existing.sha256 IN (${placeholders})
         AND existing.version_type IN ('ORIGINAL','CONVERTED','SUPPORTING','SUPPORTING_CONVERTED')
       ORDER BY existing.id`,
      hashes
    );

    // Keep one clear reference per hash in the simple upload dialog. The
    // server still prevents accidental duplicates against every matching row.
    const seen = new Set<string>();
    const matches = result.rows.filter(row => {
      if (seen.has(row.sha256)) return false;
      seen.add(row.sha256);
      return true;
    });
    return NextResponse.json({ matches });
  } catch (error) {
    return apiError(error);
  }
}
