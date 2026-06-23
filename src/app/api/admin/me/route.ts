import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return Response.json({ authenticated: false }, { status: 401 });
  return Response.json({ authenticated: true, email: admin.email });
}
