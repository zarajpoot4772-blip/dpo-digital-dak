import { NextRequest, NextResponse } from 'next/server';
import { apiError, destroySession, mutationGuard } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
