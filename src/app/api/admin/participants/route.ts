import { NextRequest } from 'next/server';
import { requireAdmin, hashPassword } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, safeText } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const category = request.nextUrl.searchParams.get('category');
  let query = supabaseAdmin.from('participants').select('id,name,usercode,category,payment_status,contest_stage,is_active,login_count,last_login_at,created_at').order('created_at', { ascending: false });
  if (category) query = query.eq('category', category);
  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true, participants: data || [] });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));

  if (Array.isArray(body.participants)) {
    const rows = [];
    for (const item of body.participants) {
      const password = safeText(item.password);
      if (!safeText(item.category) || !safeText(item.name) || !safeText(item.usercode) || !password) continue;
      rows.push({
        category: safeText(item.category),
        name: safeText(item.name),
        usercode: safeText(item.usercode),
        password_hash: await hashPassword(password),
        payment_status: safeText(item.paymentStatus || item.payment_status || 'unpaid'),
        contest_stage: safeText(item.contestStage || item.contest_stage || 'Stage 1'),
        is_active: item.isActive ?? item.is_active ?? true
      });
    }
    if (!rows.length) return jsonError('No valid participants found.');
    const { error } = await supabaseAdmin.from('participants').upsert(rows, { onConflict: 'category,usercode' });
    if (error) return jsonError(error.message, 500);
    return Response.json({ success: true, imported: rows.length });
  }

  const category = safeText(body.category);
  const name = safeText(body.name);
  const usercode = safeText(body.usercode);
  const password = safeText(body.password);
  if (!category || !name || !usercode || !password) return jsonError('Category, name, usercode and password are required.');

  const { data, error } = await supabaseAdmin
    .from('participants')
    .insert({
      category,
      name,
      usercode,
      password_hash: await hashPassword(password),
      payment_status: safeText(body.paymentStatus || body.payment_status || 'unpaid'),
      contest_stage: safeText(body.contestStage || body.contest_stage || 'Stage 1'),
      is_active: body.isActive ?? body.is_active ?? true
    })
    .select('id,name,usercode,category,payment_status,contest_stage,is_active')
    .single();

  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true, participant: data });
}
