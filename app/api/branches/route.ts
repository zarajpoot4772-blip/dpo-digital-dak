import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';

export async function GET() {
  try {
    await requireUser(['ADMIN']);
    const db = await getDb();
    const result = await db.query(
      `SELECT b.id,b.name,b.code,b.department,b.active,b.created_at,
       u.id head_user_id,u.name head_name,u.username head_username,u.active head_active
       FROM branches b LEFT JOIN users u ON u.id=b.head_user_id
       ORDER BY b.active DESC,b.name`
    );
    return NextResponse.json({ branches: result.rows });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    const admin = await requireUser(['ADMIN']);
    const body = await req.json();
    const name = String(body.name || '').trim();
    const code = String(body.code || '').trim().toUpperCase();
    const headName = String(body.head_name || '').trim();
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const department = String(body.department || 'DPO Office').trim();

    if (!name || !code || !headName || !username || password.length < 10) throw new Error('Branch, code, head name, username and 10-character password are required');
    if (name.length > 120 || headName.length > 150 || department.length > 120) throw new Error('One or more fields are too long');
    if (!/^[A-Z0-9-]{2,12}$/.test(code)) throw new Error('Branch code must be 2-12 letters, numbers or hyphens');
    if (!/^[a-z0-9._-]{3,50}$/.test(username)) throw new Error('Username may contain lowercase letters, numbers, dots, underscores and hyphens');

    const db = await getDb();
    const exists = await db.query(
      `SELECT 1 FROM branches WHERE lower(name)=lower($1) OR code=$2
       UNION ALL SELECT 1 FROM users WHERE lower(username)=lower($3)`, [name,code,username]
    );
    if (exists.rows.length) throw new Error('CONFLICT');

    const result = await db.transaction(async tx => {
      const user = await tx.query<{ id: number }>(
        `INSERT INTO users(name,username,password_hash,must_change_password,password_changed_at,role,department,branch)
         VALUES($1,$2,$3,true,now(),'BRANCH_HEAD',$4,$5) RETURNING id`,
        [headName,username,await bcrypt.hash(password,12),department,name]
      );
      const branch = await tx.query<{ id: number }>(
        `INSERT INTO branches(name,code,department,head_user_id,created_by)
         VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [name,code,department,user.rows[0].id,admin.id]
      );
      return { id: branch.rows[0].id, head_user_id: user.rows[0].id };
    });
    await persistDb();
    return NextResponse.json(result,{status:201});
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await mutationGuard(req);
    await requireUser(['ADMIN']);
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1 || typeof body.active !== 'boolean') throw new Error('Invalid branch update');
    const db = await getDb();
    const updated = await db.query<{ head_user_id: number | null }>(
      `UPDATE branches SET active=$1 WHERE id=$2 RETURNING head_user_id`, [body.active,id]
    );
    if (!updated.rows[0]) throw new Error('NOT_FOUND');
    if (updated.rows[0].head_user_id) await db.query(`UPDATE users SET active=$1 WHERE id=$2`, [body.active,updated.rows[0].head_user_id]);
    await persistDb();
    return NextResponse.json({ok:true});
  } catch (error) {
    return apiError(error);
  }
}
