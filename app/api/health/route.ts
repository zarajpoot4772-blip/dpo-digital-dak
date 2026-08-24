import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const db = await getDb();
    const result = await db.query<{ now: string; users: string }>(
      `SELECT now()::text AS now,(SELECT count(*)::text FROM users) AS users`
    );
    return NextResponse.json({ status: 'ok', database: 'ready', users: Number(result.rows[0].users), time: result.rows[0].now });
  } catch (error) {
    console.error('HEALTH_ERROR', error);
    return NextResponse.json({
      status: 'error',
      database: 'unavailable',
      error: process.env.NODE_ENV === 'production' ? 'Database unavailable' : error instanceof Error ? error.message : 'Unknown database error'
    }, { status: 500 });
  }
}
