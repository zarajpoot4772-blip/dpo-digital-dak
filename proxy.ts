import { NextRequest, NextResponse } from 'next/server';

// Authentication is cookie-based. Preview login tokens are exchanged once by
// /api/auth/preview-exchange and are never copied from URLs into API headers.
// Keeping this proxy as a no-op preserves the Next.js proxy entry point without
// creating a query-string bearer-token bypass.
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = { matcher: ['/api/:path*'] };
