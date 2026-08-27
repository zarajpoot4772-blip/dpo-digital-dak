import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';
import { validatePassword } from '@/lib/password';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    const user = await requireUser();
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
    const hash = await bcrypt.hash(newPassword, 12);
    await db.transaction(async tx => {
      await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);
      // Revoke every device/session after a credential change.
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    });
    await persistDb();
    return NextResponse.json({ ok: true, requires_login: true, message: 'Password changed. Please sign in again.' });
  } catch (error) {
    return apiError(error);
  }
}
