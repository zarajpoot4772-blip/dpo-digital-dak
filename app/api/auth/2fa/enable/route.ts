import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'otplib';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';

export const runtime = 'nodejs';

function cleanCode(value: unknown) { return String(value || '').replace(/\s/g, ''); }

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    const user = await requireUser();
    const code = cleanCode((await req.json()).code);
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit authenticator code');
    const db = await getDb();
    const account = await db.query<{ totp_pending_secret: string | null; totp_enabled: boolean }>(
      'SELECT totp_pending_secret,totp_enabled FROM users WHERE id=$1 AND active=true',
      [user.id]
    );
    if (!account.rows[0]) throw new Error('Active account not found');
    if (account.rows[0].totp_enabled) throw new Error('Two-factor authentication is already enabled');
    if (!account.rows[0].totp_pending_secret) throw new Error('Start two-factor setup first');
    const result = await verify({ secret: account.rows[0].totp_pending_secret, token: code });
    if (!result.valid) throw new Error('Authenticator code is invalid or expired');
    await db.transaction(async tx => {
      await tx.query('UPDATE users SET totp_secret=$1,totp_pending_secret=NULL,totp_enabled=true WHERE id=$2', [account.rows[0].totp_pending_secret, user.id]);
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    });
    await persistDb();
    return NextResponse.json({ ok: true, requires_login: true, message: 'Two-factor authentication enabled. Please sign in again.' });
  } catch (error) {
    return apiError(error);
  }
}
