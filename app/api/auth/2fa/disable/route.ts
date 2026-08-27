import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { verify } from 'otplib';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';

export const runtime = 'nodejs';

function cleanCode(value: unknown) { return String(value || '').replace(/\s/g, ''); }

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    const user = await requireUser();
    const body = await req.json();
    const currentPassword = String(body.current_password || '');
    const code = cleanCode(body.code);
    if (!currentPassword) throw new Error('Current password is required');
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit authenticator code');
    const db = await getDb();
    const account = await db.query<{ password_hash: string; totp_secret: string | null; totp_enabled: boolean }>(
      'SELECT password_hash,totp_secret,totp_enabled FROM users WHERE id=$1 AND active=true',
      [user.id]
    );
    if (!account.rows[0] || !(await bcrypt.compare(currentPassword, account.rows[0].password_hash))) throw new Error('Current password is incorrect');
    if (!account.rows[0].totp_enabled || !account.rows[0].totp_secret) throw new Error('Two-factor authentication is not enabled');
    const result = await verify({ secret: account.rows[0].totp_secret, token: code });
    if (!result.valid) throw new Error('Authenticator code is invalid or expired');
    await db.transaction(async tx => {
      await tx.query('UPDATE users SET totp_secret=NULL,totp_pending_secret=NULL,totp_enabled=false WHERE id=$1', [user.id]);
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    });
    await persistDb();
    return NextResponse.json({ ok: true, requires_login: true, message: 'Two-factor authentication disabled. Please sign in again.' });
  } catch (error) {
    return apiError(error);
  }
}
