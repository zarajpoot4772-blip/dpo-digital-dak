import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';

export async function GET() {
  try {
    const requester = await requireUser();
    const db = await getDb();
    const result = await db.query(
      `SELECT id,name,username,role,department,branch,active FROM users
       ${requester.role === 'ADMIN' ? '' : 'WHERE active=true'} ORDER BY active DESC,role,name`
    );
    return NextResponse.json({users:result.rows});
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    await requireUser(['ADMIN']);
    const body = await req.json();
    const name = String(body.name || '').trim();
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const role = String(body.role || '');
    if (!name || !username || password.length < 10) throw new Error('Name, username and a 10-character password are required');
    if (name.length > 150 || !/^[a-z0-9._-]{3,50}$/.test(username)) throw new Error('Invalid name or username');
    if (!['ADMIN','DPO','CLERK','OFFICER','BRANCH_HEAD'].includes(role)) throw new Error('Invalid role');

    const db = await getDb();
    try {
      const result = await db.query<{id:number}>(
        `INSERT INTO users(name,username,password_hash,role,department,branch)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [name,username,await bcrypt.hash(password,12),role,String(body.department||'').slice(0,120),String(body.branch||'').slice(0,120)]
      );
      await persistDb();
      return NextResponse.json({id:result.rows[0].id},{status:201});
    } catch (error: unknown) {
      if (error instanceof Error && error.message.toLowerCase().includes('unique')) throw new Error('CONFLICT');
      throw error;
    }
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await mutationGuard(req);
    const admin = await requireUser(['ADMIN']);
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1 || typeof body.active !== 'boolean') throw new Error('Invalid user update');
    if (id === admin.id && body.active === false) throw new Error('You cannot deactivate your own account');
    const db = await getDb();
    const target = await db.query<{role:string;active:boolean}>(`SELECT role,active FROM users WHERE id=$1`,[id]);
    if (!target.rows[0]) throw new Error('NOT_FOUND');
    if (target.rows[0].role === 'DPO' && body.active === false) {
      const count = await db.query<{count:string}>(`SELECT count(*)::text count FROM users WHERE role='DPO' AND active=true AND id<>$1`,[id]);
      if (Number(count.rows[0].count) === 0) throw new Error('At least one active DPO account is required');
    }
    await db.query(`UPDATE users SET active=$1 WHERE id=$2`,[body.active,id]);
    await db.query(`DELETE FROM sessions WHERE user_id=$1`,[id]);
    await persistDb();
    return NextResponse.json({ok:true});
  } catch (error) {
    return apiError(error);
  }
}
