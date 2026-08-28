import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb, persistDb } from '@/lib/db';
import { createSession, ipOf, mutationGuard, sessionResponse } from '@/lib/auth';

export const runtime = 'nodejs';
const MAX_LOGIN_FAILURES = 5;

function normalizedUsername(value: string) {
  return value.trim().toLowerCase().slice(0, 100);
}

function throttleKey(username: string, ip: string) {
  return crypto.createHash('sha256').update(`${username}|${ip}`).digest('hex');
}

async function persistThrottle() {
  try { await persistDb(); } catch (error) { console.error('LOGIN_THROTTLE_PERSIST_ERROR', error); }
}

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    const body = await req.json();
    const username = typeof body?.username === 'string' ? body.username : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (typeof body?.username !== 'string' || typeof body?.password !== 'string') throw new Error('Invalid credentials');

    const loginName = normalizedUsername(username);
    const sourceIp = ipOf(req).slice(0, 120) || 'local';
    const lockKey = throttleKey(loginName, sourceIp);
    const db = await getDb();
    await db.query(`DELETE FROM login_throttle WHERE updated_at<now()-interval '1 day'`);
    const existingThrottle = await db.query<{ locked_until: string | Date | null }>(
      'SELECT locked_until FROM login_throttle WHERE lock_key=$1',
      [lockKey]
    );
    const lockedUntil = existingThrottle.rows[0]?.locked_until;
    if (lockedUntil && new Date(String(lockedUntil)).getTime() > Date.now()) {
      return NextResponse.json({ error: 'Account access temporarily locked. Try again later.' }, { status: 429 });
    }

    const result = await db.query<{ id: number; password_hash: string; active: boolean; name: string; role: string; totp_enabled: boolean; must_change_password: boolean }>(
      'SELECT id,password_hash,active,name,role,totp_enabled,must_change_password FROM users WHERE lower(username)=lower($1)',
      [loginName]
    );
    const user = result.rows[0];
    if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
      const failure = await db.query<{ locked_until: string | Date | null }>(
        `INSERT INTO login_throttle(lock_key,username,ip,failed_count,locked_until,updated_at)
         VALUES($1,$2,$3,1,NULL,now())
         ON CONFLICT(lock_key) DO UPDATE SET
           failed_count=CASE WHEN login_throttle.updated_at<now()-interval '15 minutes' THEN 1 ELSE login_throttle.failed_count+1 END,
           locked_until=CASE
             WHEN login_throttle.updated_at<now()-interval '15 minutes' THEN NULL
             WHEN login_throttle.failed_count+1>=$4 THEN now()+interval '15 minutes'
             ELSE login_throttle.locked_until
           END,
           updated_at=now()
         RETURNING locked_until`,
        [lockKey, loginName, sourceIp, MAX_LOGIN_FAILURES]
      );
      await persistThrottle();
      if (failure.rows[0]?.locked_until && new Date(String(failure.rows[0].locked_until)).getTime() > Date.now()) {
        return NextResponse.json({ error: 'Account access temporarily locked. Try again later.' }, { status: 429 });
      }
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    await db.query('DELETE FROM login_throttle WHERE lock_key=$1', [lockKey]);
    await persistThrottle();
    const passwordStatus = { password_change_required: Boolean(user.must_change_password) };
    if (user.totp_enabled) {
      await db.query('DELETE FROM mfa_challenges WHERE expires_at<now()');
      const challenge = crypto.randomBytes(32).toString('hex');
      await db.query('INSERT INTO mfa_challenges(id,user_id,expires_at) VALUES($1,$2,now()+interval \'10 minutes\')', [challenge, user.id]);
      return NextResponse.json({ mfa_required: true, challenge_token: challenge, user: { id: user.id, name: user.name, role: user.role, ...passwordStatus } });
    }
    const token = await createSession(user.id, req);
    return sessionResponse({ user: { id: user.id, name: user.name, role: user.role, totp_enabled: user.totp_enabled, ...passwordStatus } }, token);
  } catch (error) {
    console.error('LOGIN_ERROR', error);
    const detail = error instanceof Error ? error.message : 'Unknown database error';
    return NextResponse.json({ error: process.env.NODE_ENV === 'production' ? 'Unable to sign in' : `Local database error: ${detail}` }, { status: 500 });
  }
}
