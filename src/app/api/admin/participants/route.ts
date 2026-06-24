import { NextRequest } from 'next/server';
import { requireAdmin, hashPassword } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, safeText } from '@/lib/utils';

type StageSettings = Record<string, { isOpen?: boolean }>;

async function getStageOpenMap(): Promise<StageSettings> {
  const { data } = await supabaseAdmin.from('app_config').select('value').eq('key', 'stageSettings').maybeSingle();
  return data?.value && typeof data.value === 'object' ? data.value as StageSettings : {};
}

function isStageOpen(stageSettings: StageSettings, stage: string) {
  if (!stageSettings || !stageSettings[stage]) return stage === 'Stage 1';
  return Boolean(stageSettings[stage]?.isOpen);
}

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
  const stageSettings = await getStageOpenMap();

  if (Array.isArray(body.participants)) {
    const rows = [];
    for (const item of body.participants) {
      const password = safeText(item.password);
      const contestStage = safeText(item.contestStage || item.contest_stage || 'Stage 1');
      if (!safeText(item.category) || !safeText(item.name) || !safeText(item.usercode) || !password) continue;
      rows.push({
        category: safeText(item.category),
        name: safeText(item.name),
        usercode: safeText(item.usercode),
        password_hash: await hashPassword(password),
        payment_status: safeText(item.paymentStatus || item.payment_status || 'unpaid'),
        contest_stage: contestStage,
        is_active: item.isActive ?? item.is_active ?? isStageOpen(stageSettings, contestStage)
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
  const contestStage = safeText(body.contestStage || body.contest_stage || 'Stage 1');
  if (!category || !name || !usercode || !password) return jsonError('Category, name, usercode and password are required.');

  const { data, error } = await supabaseAdmin
    .from('participants')
    .insert({
      category,
      name,
      usercode,
      password_hash: await hashPassword(password),
      payment_status: safeText(body.paymentStatus || body.payment_status || 'unpaid'),
      contest_stage: contestStage,
      is_active: body.isActive ?? body.is_active ?? isStageOpen(stageSettings, contestStage)
    })
    .select('id,name,usercode,category,payment_status,contest_stage,is_active')
    .single();

  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true, participant: data });
}