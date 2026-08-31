import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const db = await getDb();
    await db.query('SELECT 1');
    // Keep monitoring useful without exposing internal user counts or other
    // database details to unauthenticated callers.
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('HEALTH_ERROR', error);
    return NextResponse.json({
      status: 'error',
      database: 'unavailable',
      error: process.env.NODE_ENV === 'production' ? 'Database unavailable' : error instanceof Error ? error.message : 'Unknown database error'
    }, { status: 500 });
  }
}
