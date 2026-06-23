import { NextResponse } from 'next/server';
import { COOKIE_NAMES } from '@/lib/constants';
import { clearCookie } from '@/lib/auth';

export async function POST() {
  const response = NextResponse.json({ success: true });
  clearCookie(response, COOKIE_NAMES.participant);
  return response;
}
