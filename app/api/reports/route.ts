import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

function readDate(value: string, label: string) {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const db = await getDb();
    const args: unknown[] = [];
    const where: string[] = [];
    if (user.role === 'OFFICER') {
      args.push(user.id);
      where.push(`d.assigned_to=$${args.length}`);
    } else if (user.role === 'BRANCH_HEAD') {
      args.push(user.branch, user.id);
      where.push(`(d.branch=$${args.length - 1} OR d.assigned_to=$${args.length})`);
    }
    const dateFrom = readDate((req.nextUrl.searchParams.get('date_from') || '').trim(), 'start date');
    const dateTo = readDate((req.nextUrl.searchParams.get('date_to') || '').trim(), 'end date');
    const branch = (req.nextUrl.searchParams.get('branch') || '').trim().slice(0, 120);
    if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('Start date must not be after end date');
    if (dateFrom) { args.push(dateFrom); where.push(`d.received_date >= $${args.length}`); }
    if (dateTo) { args.push(dateTo); where.push(`d.received_date <= $${args.length}`); }
    if (branch) { args.push(branch); where.push(`d.branch=$${args.length}`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const summary = await db.query<any>(
      `SELECT count(*)::text total,
       count(*) FILTER (WHERE d.status IN ('PENDING','OPENED'))::text pending,
       count(*) FILTER (WHERE d.status='FORWARDED')::text forwarded,
       count(*) FILTER (WHERE d.status='APPROVED')::text approved,
       count(*) FILTER (WHERE d.status='REJECTED')::text rejected,
       count(*) FILTER (WHERE d.status='ARCHIVED')::text archived,
       count(*) FILTER (WHERE d.priority='URGENT' AND d.status NOT IN ('APPROVED','REJECTED','ARCHIVED'))::text urgent
       FROM daks d ${clause}`,
      args
    );
    const byBranch = await db.query<any>(
      `SELECT COALESCE(d.branch,'Unassigned Branch') branch,count(*)::text total,
       count(*) FILTER (WHERE d.status IN ('PENDING','OPENED'))::text pending,
       count(*) FILTER (WHERE d.status='FORWARDED')::text forwarded,
       count(*) FILTER (WHERE d.status='APPROVED')::text approved,
       count(*) FILTER (WHERE d.status='REJECTED')::text rejected
       FROM daks d ${clause}
       GROUP BY COALESCE(d.branch,'Unassigned Branch') ORDER BY count(*) DESC,branch`,
      args
    );
    const byPriority = await db.query<any>(
      `SELECT d.priority,count(*)::text total FROM daks d ${clause} GROUP BY d.priority
       ORDER BY CASE d.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END`,
      args
    );
    const byStatus = await db.query<any>(
      `SELECT d.status,count(*)::text total FROM daks d ${clause} GROUP BY d.status ORDER BY d.status`,
      args
    );
    return NextResponse.json({
      filters: { date_from: dateFrom, date_to: dateTo, branch },
      summary: summary.rows[0] || {},
      by_branch: byBranch.rows,
      by_priority: byPriority.rows,
      by_status: byStatus.rows
    });
  } catch (error) {
    return apiError(error);
  }
}
