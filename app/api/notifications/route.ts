import { NextRequest, NextResponse } from 'next/server';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';

export async function GET() {
  try {
    const user = await requireUser();
    const db = await getDb();
    await db.query(
      `INSERT INTO notifications(user_id,dak_id,message)
       SELECT $1,d.id,
        CASE
          WHEN d.due_date<current_date THEN 'SLA alert: Dak '||d.diary_number||' is overdue (due '||d.due_date::text||').'
          WHEN d.due_date=current_date THEN 'SLA alert: Dak '||d.diary_number||' is due today.'
          ELSE 'SLA alert: Dak '||d.diary_number||' is due tomorrow.'
        END
       FROM daks d
       WHERE d.assigned_to=$1 AND d.due_date IS NOT NULL
         AND d.due_date<=current_date+1
         AND d.status NOT IN ('APPROVED','REJECTED','ARCHIVED')
         AND NOT EXISTS (
           SELECT 1 FROM notifications old
           WHERE old.user_id=$1 AND old.dak_id=d.id
             AND old.message LIKE 'SLA alert:%'
             AND old.created_at::date=current_date
         )`,
      [user.id]
    );
    await persistDb();
    const result = await db.query(
      `SELECT n.*,d.diary_number FROM notifications n LEFT JOIN daks d ON d.id=n.dak_id
       WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 30`,
      [user.id]
    );
    return NextResponse.json({ items: result.rows, unread: result.rows.filter((item: any) => !item.is_read).length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    const user = await requireUser();
    const db = await getDb();
    await db.query('UPDATE notifications SET is_read=true WHERE user_id=$1', [user.id]);
    await persistDb();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
