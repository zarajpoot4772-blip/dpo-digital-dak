import { NextRequest, NextResponse } from 'next/server';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

const SHA256 = /^[a-f0-9]{64}$/i;

type DuplicateRow = {
  sha256: string;
  dak_id: number | null;
  diary_number: string;
  subject: string;
  received_date: string;
  status: string;
  original_filename: string;
  version_type: string;
  assigned_to: number | null;
  branch: string | null;
};

/**
 * Check a selected upload batch before any Dak record or file is created.
 * The final duplicate check remains in the upload route as a race-condition
 * and API-tampering safeguard; this endpoint only makes the user decision
 * possible before the upload starts.
 */
export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    const user = await requireUser();
    const body = await req.json();
    if (!Array.isArray(body?.hashes)) throw new Error('Invalid duplicate check request');

    const rawHashes: unknown[] = body.hashes;
    const hashes = [...new Set(rawHashes.filter((value: unknown): value is string => typeof value === 'string').map((value: string) => value.trim().toLowerCase()))];
    if (hashes.length > 50) throw new Error('A maximum of 50 files can be checked at once');
    if (hashes.some(hash => !SHA256.test(hash))) throw new Error('Invalid file hash');
    if (!hashes.length) return NextResponse.json({ matches: [] });

    const db = await getDb();
    const placeholders = hashes.map((_, index) => `$${index + 1}`).join(',');
    const result = await db.query<DuplicateRow>(
      `SELECT existing.sha256,existing.dak_id,d.diary_number,d.subject,d.received_date,d.status,
              existing.original_filename,existing.version_type,d.assigned_to,d.branch
       FROM documents existing
       JOIN daks d ON d.id=existing.dak_id
       WHERE existing.sha256 IN (${placeholders})
         AND existing.version_type IN ('ORIGINAL','CONVERTED','SUPPORTING','SUPPORTING_CONVERTED')
       ORDER BY existing.id`,
      hashes
    );

    const canSeeDetails = (row: DuplicateRow) =>
      ['ADMIN', 'DPO', 'CLERK'].includes(user.role)
      || (user.role === 'OFFICER' && row.assigned_to === user.id)
      || (user.role === 'BRANCH_HEAD' && (row.branch === user.branch || row.assigned_to === user.id));

    // Return one clear reference per hash. If the matching record belongs to a
    // different branch/assigned officer, reveal only that a protected record
    // exists rather than leaking its diary number or subject.
    const matches: DuplicateRow[] = [];
    for (const hash of hashes) {
      const rows = result.rows.filter(row => row.sha256 === hash);
      if (!rows.length) continue;
      const visible = rows.find(canSeeDetails);
      if (visible) {
        matches.push(visible);
      } else {
        matches.push({
          ...rows[0],
          dak_id: null,
          diary_number: 'Existing protected record',
          subject: 'This file already exists in the system',
          received_date: '',
          status: 'PROTECTED',
          original_filename: 'Protected document',
          version_type: 'PROTECTED',
          assigned_to: null,
          branch: null
        });
      }
    }
    return NextResponse.json({ matches });
  } catch (error) {
    return apiError(error);
  }
}
