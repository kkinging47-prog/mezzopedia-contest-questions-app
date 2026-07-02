import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, safeText } from '@/lib/utils';

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return jsonError('No email rows found.');

  let updated = 0;
  const failed: string[] = [];
  for (const row of rows) {
    const usercode = safeText(row.usercode || row.code);
    const email = safeText(row.email).toLowerCase();
    if (!usercode || !email) { failed.push(usercode || 'missing code'); continue; }
    const { error } = await supabaseAdmin
      .from('participants')
      .update({ email })
      .ilike('usercode', usercode);
    if (error) failed.push(`${usercode}: ${error.message}`);
    else updated += 1;
  }

  return Response.json({ success: true, updated, failed });
}
