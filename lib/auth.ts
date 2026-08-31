import { cookies, headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb } from './db';

export type Role='ADMIN'|'DPO'|'CLERK'|'OFFICER'|'BRANCH_HEAD';
export type User={
  id:number;
  name:string;
  username:string;
  role:Role;
  department:string|null;
  branch:string|null;
  totp_enabled?:boolean;
  must_change_password?:boolean;
  password_change_required?:boolean;
};
const COOKIE='dpo_session';

type PasswordUser=User&{must_change_password?:boolean};

function decorateUser(row:PasswordUser):User{
 return {
  ...row,
  password_change_required:Boolean(row.must_change_password)
 };
}

export async function currentUser(previewToken?:string|null):Promise<User|null>{
 const c=await cookies(); const h=await headers(); const bearer=h.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]; const token=c.get(COOKIE)?.value||(process.env.NODE_ENV!=='production'?(previewToken||bearer):undefined);const db=await getDb();
 if(!token)return null;
 const r=await db.query<PasswordUser>(`SELECT u.id,u.name,u.username,u.role,u.department,u.branch,u.totp_enabled,u.must_change_password FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>now() AND u.active=true`,[token]); return r.rows[0]?decorateUser(r.rows[0]):null;
}
export async function requireUser(roles?:Role[],previewToken?:string|null,options?:{allowPasswordChange?:boolean}){const u=await currentUser(previewToken);if(!u)throw new Error('UNAUTHORIZED');if(roles&&!roles.includes(u.role))throw new Error('FORBIDDEN');if(!options?.allowPasswordChange&&u.password_change_required)throw new Error('PASSWORD_CHANGE_REQUIRED');return u;}
export async function createSession(userId:number,req:NextRequest){const db=await getDb();const token=crypto.randomBytes(32).toString('hex');await db.query('DELETE FROM sessions WHERE expires_at<now()');await db.query(`INSERT INTO sessions(id,user_id,expires_at,ip,user_agent) VALUES($1,$2,now()+interval '8 hours',$3,$4)`,[token,userId,ipOf(req),req.headers.get('user-agent')?.slice(0,300)]);return token;}
export async function destroySession(){const c=await cookies();const t=c.get(COOKIE)?.value;if(t){const db=await getDb();await db.query('DELETE FROM sessions WHERE id=$1',[t]);}c.delete(COOKIE);}
function sessionCookieOptions(req?:NextRequest){
 const arena=process.env.NEXT_PUBLIC_ARENA_PREVIEW==='1';
 const forwardedProtocol=req?.headers.get('x-forwarded-proto')?.split(',')[0].trim();
 const isHttps=process.env.NODE_ENV==='production'||req?.nextUrl.protocol==='https:'||forwardedProtocol==='https';
 return {httpOnly:true as const,sameSite:(arena&&isHttps?'none':'strict') as 'none'|'strict',secure:isHttps,partitioned:arena&&isHttps,path:'/',maxAge:8*3600};
}
export function setSessionCookie(response:NextResponse,token:string,req?:NextRequest){response.cookies.set(COOKIE,token,sessionCookieOptions(req));return response;}
export function sessionResponse(data:unknown,token:string,req?:NextRequest){const arena=process.env.NEXT_PUBLIC_ARENA_PREVIEW==='1';const payload=arena&&data&&typeof data==='object'?{...(data as Record<string,unknown>),preview_token:token}:data;return setSessionCookie(NextResponse.json(payload),token,req);}
export function ipOf(req:NextRequest){return (req.headers.get('x-forwarded-for')||req.headers.get('x-real-ip')||'local').split(',')[0].trim();}
export function apiError(error:unknown){
 const message=error instanceof Error?error.message:'ERROR';
 const knownStatus:Record<string,number>={UNAUTHORIZED:401,FORBIDDEN:403,NOT_FOUND:404,CONFLICT:409,PASSWORD_CHANGE_REQUIRED:403};
 if(knownStatus[message])return NextResponse.json({error:message.replaceAll('_',' ').toLowerCase()},{status:knownStatus[message]});
 const safe=/required|requires|install|invalid|must|only |cannot|already|finalized|file |remarks|reason|recipient|username|password|too long|too large|exceeds|empty|unsupported|no active|at least|different forward|does not match|not configured|approval|position|page|asset|document preview|awaiting|expired/i.test(message);
 if(safe)return NextResponse.json({error:message},{status:400});
 console.error('API_ERROR',error);
 return NextResponse.json({error:'Internal server error'},{status:500});
}
export async function mutationGuard(req:NextRequest){const origin=req.headers.get('origin'),host=req.headers.get('host');if(origin&&host&&new URL(origin).host!==host)throw new Error('FORBIDDEN');}
export async function requestMeta(req:NextRequest){const h=await headers();return {ip:ipOf(req),ua:h.get('user-agent')?.slice(0,300)||''};}
