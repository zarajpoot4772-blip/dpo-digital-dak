import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';
import { createSession, mutationGuard, sessionResponse } from '@/lib/auth';

export const runtime = 'nodejs';
const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    const key = (req.headers.get('x-forwarded-for') || 'local').split(',')[0];
    const attempt = attempts.get(key);
    if (attempt && attempt.n >= 5 && attempt.until > Date.now()) {
      return NextResponse.json({ error: 'Account access temporarily locked. Try again later.' }, { status: 429 });
    }
    const { username, password } = await req.json();
    if (typeof username !== 'string' || typeof password !== 'string') throw new Error('Invalid credentials');
    const db = await getDb();
    const result = await db.query<{ id: number; password_hash: string; active: boolean; name: string; role: string; totp_enabled: boolean }>(
      'SELECT id,password_hash,active,name,role,totp_enabled FROM users WHERE lower(username)=lower($1)',
      [username.trim()]
    );
    const user = result.rows[0];
    if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
      attempts.set(key, { n: (attempt?.n || 0) + 1, until: Date.now() + 15 * 60_000 });
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }
    attempts.delete(key);
    if (user.totp_enabled) {
      await db.query('DELETE FROM mfa_challenges WHERE expires_at<now()');
      const challenge = crypto.randomBytes(32).toString('hex');
      await db.query('INSERT INTO mfa_challenges(id,user_id,expires_at) VALUES($1,$2,now()+interval \'10 minutes\')', [challenge, user.id]);
      return NextResponse.json({ mfa_required: true, challenge_token: challenge, user: { id: user.id, name: user.name, role: user.role } });
    }
    const token = await createSession(user.id, req);
    return sessionResponse({ user: { id: user.id, name: user.name, role: user.role, totp_enabled: user.totp_enabled } }, token);
  } catch (error) {
    console.error('LOGIN_ERROR', error);
    const detail = error instanceof Error ? error.message : 'Unknown database error';
    return NextResponse.json({ error: process.env.NODE_ENV === 'production' ? 'Unable to sign in' : `Local database error: ${detail}` }, { status: 500 });
  }
}
