import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_ARENA_PREVIEW !== '1') return NextResponse.next();
  let token = request.nextUrl.searchParams.get('auth');
  if (!token) {
    const ref = request.headers.get('referer');
    if (ref) {
      try { token = new URL(ref).searchParams.get('auth'); } catch { /* malformed referrer */ }
    }
  }
  if (!token) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${token}`);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/api/:path*'] };
