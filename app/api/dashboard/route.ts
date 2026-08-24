import { NextResponse } from 'next/server';
import { apiError, requireUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const user = await requireUser();
    const db = await getDb();
    const args: unknown[] = [];
    let scope = '';
    let aliasedScope = '';

    if (user.role === 'OFFICER') {
      args.push(user.id);
      scope = ' WHERE assigned_to=$1';
      aliasedScope = 'WHERE d.assigned_to=$1';
    } else if (user.role === 'BRANCH_HEAD') {
      args.push(user.branch, user.id);
      scope = ' WHERE (branch=$1 OR assigned_to=$2)';
      aliasedScope = 'WHERE (d.branch=$1 OR d.assigned_to=$2)';
    }

    const statuses = await db.query<{ status: string; count: string }>(
      `SELECT status,count(*)::text count FROM daks${scope} GROUP BY status`, args
    );
    const total = statuses.rows.reduce((sum, row) => sum + Number(row.count), 0);
    const today = await db.query<{ count: string }>(
      `SELECT count(*)::text count FROM daks${scope ? `${scope} AND` : ' WHERE'} received_date=current_date`, args
    );
    const urgent = await db.query<{ count: string }>(
      `SELECT count(*)::text count FROM daks${scope ? `${scope} AND` : ' WHERE'} priority='URGENT' AND status NOT IN ('APPROVED','REJECTED','ARCHIVED')`, args
    );
    const recent = await db.query(
      `SELECT d.id,d.diary_number,d.subject,d.priority,d.status,d.updated_at,u.name assigned_name
       FROM daks d LEFT JOIN users u ON u.id=d.assigned_to ${aliasedScope}
       ORDER BY d.updated_at DESC LIMIT 6`, args
    );

    return NextResponse.json({
      counts: Object.fromEntries(statuses.rows.map(row => [row.status, Number(row.count)])),
      total,
      today: Number(today.rows[0].count),
      urgent: Number(urgent.rows[0].count),
      recent: recent.rows
    });
  } catch (error) {
    return apiError(error);
  }
}
