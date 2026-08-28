import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';
import { validatePassword } from '@/lib/password';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    // A forced first-login/expired-password session is allowed to reach only this route.
    const user = await requireUser(undefined, undefined, { allowPasswordChange: true });
    const body = await req.json();
    const currentPassword = String(body.current_password || '');
    const newPassword = validatePassword(body.new_password);
    const confirmation = String(body.confirm_password || '');
    if (!currentPassword) throw new Error('Current password is required');
    if (newPassword !== confirmation) throw new Error('New password and confirmation do not match');
    if (currentPassword === newPassword) throw new Error('New password must be different from the current password');

    const db = await getDb();
    const account = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1 AND active=true', [user.id]);
    if (!account.rows[0] || !(await bcrypt.compare(currentPassword, account.rows[0].password_hash))) {
      throw new Error('Current password is incorrect');
    }
    const history = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM password_history WHERE user_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 5',
      [user.id]
    );
    for (const previous of [account.rows[0], ...history.rows]) {
      if (await bcrypt.compare(newPassword, previous.password_hash)) throw new Error('New password was used recently. Choose a different password');
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await db.transaction(async tx => {
      await tx.query(
        'INSERT INTO password_history(user_id,password_hash,changed_by) VALUES($1,$2,$3)',
        [user.id, account.rows[0].password_hash, user.id]
      );
      await tx.query(
        'UPDATE users SET password_hash=$1,must_change_password=false,password_changed_at=now() WHERE id=$2',
        [hash, user.id]
      );
      await tx.query(
        'DELETE FROM password_history WHERE user_id=$1 AND id NOT IN (SELECT id FROM password_history WHERE user_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 5)',
        [user.id]
      );
      // Revoke every device/session after a credential change.
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    });
    await persistDb();
    return NextResponse.json({ ok: true, requires_login: true, message: 'Password changed. Please sign in again.' });
  } catch (error) {
    return apiError(error);
  }
}
