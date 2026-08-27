import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'otplib';
import { apiError, createSession, mutationGuard, sessionResponse } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

function cleanCode(value: unknown) { return String(value || '').replace(/\s/g, ''); }

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    const body = await req.json();
    const challenge = String(body.challenge_token || '').trim();
    const code = cleanCode(body.code);
    if (!/^[a-f0-9]{64}$/i.test(challenge)) throw new Error('Two-factor challenge is invalid or expired');
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit authenticator code');
    const db = await getDb();
    const result = await db.query<{ id: string; user_id: number; name: string; role: string; totp_secret: string }>(
      `SELECT c.id,c.user_id,u.name,u.role,u.totp_secret
       FROM mfa_challenges c JOIN users u ON u.id=c.user_id
       WHERE c.id=$1 AND c.expires_at>now() AND u.active=true AND u.totp_enabled=true`,
      [challenge]
    );
    const row = result.rows[0];
    if (!row || !row.totp_secret) throw new Error('Two-factor challenge is invalid or expired');
    const valid = await verify({ secret: row.totp_secret, token: code });
    if (!valid.valid) throw new Error('Authenticator code is invalid or expired');
    await db.query('DELETE FROM mfa_challenges WHERE id=$1', [challenge]);
    const token = await createSession(row.user_id, req);
    return sessionResponse({ user: { id: row.user_id, name: row.name, role: row.role, totp_enabled: true } }, token);
  } catch (error) {
    return apiError(error);
  }
}
