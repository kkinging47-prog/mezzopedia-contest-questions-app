import { NextResponse } from 'next/server';
import { COOKIE_NAMES } from '@/lib/constants';
import { setSecureCookie, signToken, verifyPassword } from '@/lib/auth';
import { jsonError } from '@/lib/utils';

export async function POST(request: Request) {
  const { email, password } = await request.json().catch(() => ({}));

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!adminEmail || !adminPasswordHash) {
    return jsonError('Admin login is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD_HASH in Vercel.', 500);
  }

  if (!email || !password || String(email).toLowerCase() !== adminEmail.toLowerCase()) {
    return jsonError('Invalid admin login details.', 401);
  }

  const ok = await verifyPassword(String(password), adminPasswordHash);
  if (!ok) return jsonError('Invalid admin login details.', 401);

  const token = await signToken({ type: 'admin', email: adminEmail }, 60 * 60 * 8);
  const response = NextResponse.json({ success: true });
  setSecureCookie(response, COOKIE_NAMES.admin, token, 60 * 60 * 8);
  return response;
}
