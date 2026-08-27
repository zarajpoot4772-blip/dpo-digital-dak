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
    const activeScope = aliasedScope ? `${aliasedScope} AND` : 'WHERE';
    const ageing = await db.query(
      `SELECT d.id,d.diary_number,d.subject,d.branch,d.priority,d.status,d.received_date,
       GREATEST(0,current_date-d.received_date)::text pending_days
       FROM daks d ${activeScope} d.status NOT IN ('APPROVED','REJECTED','ARCHIVED')
       ORDER BY CASE d.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
       GREATEST(0,current_date-d.received_date) DESC,d.updated_at ASC LIMIT 8`, args
    );
    const branchLoad = await db.query(
      `SELECT COALESCE(d.branch,'Unassigned Branch') branch,count(*)::text total,
       count(*) FILTER (WHERE d.status NOT IN ('APPROVED','REJECTED','ARCHIVED'))::text active,
       count(*) FILTER (WHERE d.priority='URGENT' AND d.status NOT IN ('APPROVED','REJECTED','ARCHIVED'))::text urgent
       FROM daks d ${aliasedScope} GROUP BY COALESCE(d.branch,'Unassigned Branch')
       ORDER BY count(*) DESC,branch LIMIT 12`, args
    );

    return NextResponse.json({
      counts: Object.fromEntries(statuses.rows.map(row => [row.status, Number(row.count)])),
      total,
      today: Number(today.rows[0].count),
      urgent: Number(urgent.rows[0].count),
      recent: recent.rows,
      ageing: ageing.rows,
      branch_load: branchLoad.rows
    });
  } catch (error) {
    return apiError(error);
  }
}
