import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { generateSecret, generateURI } from 'otplib';
import { apiError, mutationGuard, requireUser } from '@/lib/auth';
import { getDb, persistDb } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    await mutationGuard(req);
    const user = await requireUser();
    const db = await getDb();
    const account = await db.query<{ totp_enabled: boolean }>('SELECT totp_enabled FROM users WHERE id=$1 AND active=true', [user.id]);
    if (!account.rows[0]) throw new Error('Active account not found');
    if (account.rows[0].totp_enabled) throw new Error('Two-factor authentication is already enabled');
    const secret = generateSecret();
    const uri = generateURI({ secret, issuer: 'DPO Digital Dak', label: user.username });
    const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
    await db.query('UPDATE users SET totp_pending_secret=$1 WHERE id=$2', [secret, user.id]);
    await persistDb();
    return NextResponse.json({ ok: true, secret, otpauth_uri: uri, qr_data_url: qrDataUrl });
  } catch (error) {
    return apiError(error);
  }
}
