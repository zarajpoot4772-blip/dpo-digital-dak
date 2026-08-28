import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';
import { validatePassword } from '@/lib/password';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await mutationGuard(req);
    const admin = await requireUser(['ADMIN']);
    const { id } = await params;
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId < 1) throw new Error('Invalid user account');
    if (userId === admin.id) throw new Error('Use Change password for your own account');
    const body = await req.json();
    const newPassword = validatePassword(body.new_password);
    if (newPassword !== String(body.confirm_password || '')) throw new Error('New password and confirmation do not match');

    const db = await getDb();
    const target = await db.query<{ name: string; active: boolean; password_hash: string }>(
      'SELECT name,active,password_hash FROM users WHERE id=$1',
      [userId]
    );
    if (!target.rows[0]) throw new Error('NOT_FOUND');
    if (!target.rows[0].active) throw new Error('Activate the user account before resetting its password');
    const history = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM password_history WHERE user_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 5',
      [userId]
    );
    for (const previous of [target.rows[0], ...history.rows]) {
      if (await bcrypt.compare(newPassword, previous.password_hash)) throw new Error('New password was used recently. Choose a different password');
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await db.transaction(async tx => {
      await tx.query(
        'INSERT INTO password_history(user_id,password_hash,changed_by) VALUES($1,$2,$3)',
        [userId, target.rows[0].password_hash, admin.id]
      );
      await tx.query(
        'UPDATE users SET password_hash=$1,must_change_password=true,password_changed_at=now() WHERE id=$2',
        [hash, userId]
      );
      await tx.query(
        'DELETE FROM password_history WHERE user_id=$1 AND id NOT IN (SELECT id FROM password_history WHERE user_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 5)',
        [userId]
      );
      // A reset invalidates every old login for that user.
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
    });
    await persistDb();
    return NextResponse.json({ ok: true, user: target.rows[0].name, requires_login: true, must_change_password: true, message: 'Password reset successfully. The user must sign in and change the temporary password.' });
  } catch (error) {
    return apiError(error);
  }
}
