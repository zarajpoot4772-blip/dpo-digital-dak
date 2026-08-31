import {NextRequest,NextResponse} from 'next/server';
import fs from 'fs/promises';
import {apiError,requireUser} from '@/lib/auth';
import {getDb} from '@/lib/db';
import {signatureStoragePath} from '@/lib/files';
export const runtime='nodejs';
export async function GET(req:NextRequest,{params}:{params:Promise<{userId:string}>}){try{const {userId}=await params;const id=Number(userId);const user=await requireUser();if(user.role!=='ADMIN'&&user.id!==id)throw new Error('FORBIDDEN');const assetType=(req.nextUrl.searchParams.get('type')||'SIGNATURE').toUpperCase();if(!['SIGNATURE','STAMP'].includes(assetType))throw new Error('Invalid approval asset type');const db=await getDb();const q=await db.query<any>(`SELECT stored_filename,sha256 FROM user_signatures WHERE user_id=$1 AND asset_type=$2 AND active=true ORDER BY id DESC LIMIT 1`,[id,assetType]);if(!q.rows[0])throw new Error('NOT_FOUND');const bytes=await fs.readFile(signatureStoragePath(q.rows[0].stored_filename));return new NextResponse(bytes,{headers:{'Content-Type':'image/png','Content-Disposition':'inline; filename="dpo-signature.png"','Cache-Control':'private, no-store','X-Signature-SHA256':q.rows[0].sha256}})}catch(e){return apiError(e)}}
