import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const { data, error } = await supabaseAdmin.from('app_config').select('key,value').order('key');
  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true, config: data || [] });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const rows = Object.entries(body.config || body).map(([key, value]) => ({ key, value }));
  if (!rows.length) return jsonError('No config values provided.');

  const { error } = await supabaseAdmin.from('app_config').upsert(rows, { onConflict: 'key' });
  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true });
}
