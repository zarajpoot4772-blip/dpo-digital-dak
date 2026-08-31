import { NextRequest, NextResponse } from 'next/server';
import { apiError, createSession, setSessionCookie } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Arena's embedded preview may need a short navigation token because browsers
 * can block third-party cookies. Exchange it once for a normal HttpOnly
 * session cookie, then redirect to a clean /portal URL. The query token is
 * never accepted by ordinary API routes and is rotated immediately.
 */
export async function GET(req: NextRequest) {
  try {
    if (process.env.NEXT_PUBLIC_ARENA_PREVIEW !== '1') return NextResponse.redirect(new URL('/', req.url));
    const token = req.nextUrl.searchParams.get('token') || '';
    if (!/^[a-f0-9]{64}$/i.test(token)) return NextResponse.redirect(new URL('/', req.url));

    const db = await getDb();
    const result = await db.query<{ user_id: number }>(
      `SELECT s.user_id
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.id=$1 AND s.expires_at>now() AND u.active=true`,
      [token]
    );
    if (!result.rows[0]) return NextResponse.redirect(new URL('/', req.url));

    const nextToken = await createSession(result.rows[0].user_id, req);
    await db.query('DELETE FROM sessions WHERE id=$1', [token]);
    await persistDb();
    const response = NextResponse.redirect(new URL('/portal', req.url), 303);
    response.headers.set('Cache-Control', 'no-store');
    return setSessionCookie(response, nextToken, req);
  } catch (error) {
    if (error instanceof Error && error.message === 'FORBIDDEN') return NextResponse.redirect(new URL('/', req.url));
    return apiError(error);
  }
}
