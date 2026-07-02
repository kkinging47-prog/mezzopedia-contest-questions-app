import { NextRequest } from 'next/server';
import { requireAdmin, hashPassword } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, safeText } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type StageSettings = Record<string, { isOpen?: boolean }>;

type ParticipantInput = {
  category?: unknown;
  name?: unknown;
  usercode?: unknown;
  password?: unknown;
  paymentStatus?: unknown;
  payment_status?: unknown;
  contestStage?: unknown;
  contest_stage?: unknown;
  isActive?: unknown;
  is_active?: unknown;
};

async function getStageOpenMap(): Promise<StageSettings> {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_config')
      .select('value')
      .eq('key', 'stageSettings')
      .maybeSingle();

    if (error) return {};
    return data?.value && typeof data.value === 'object' ? data.value as StageSettings : {};
  } catch {
    return {};
  }
}

function isStageOpen(stageSettings: StageSettings, stage: string) {
  if (!stageSettings || !stageSettings[stage]) return stage === 'Stage 1';
  return Boolean(stageSettings[stage]?.isOpen);
}

function cleanParticipantInput(item: ParticipantInput, stageSettings: StageSettings) {
  const category = safeText(item.category);
  const name = safeText(item.name);
  const usercode = safeText(item.usercode);
  const password = safeText(item.password);
  const contestStage = safeText(item.contestStage || item.contest_stage || 'Stage 1');
  const paymentStatus = safeText(item.paymentStatus || item.payment_status || 'unpaid') || 'unpaid';

  if (!category || !name || !usercode || !password) return null;

  const explicitActive = item.isActive ?? item.is_active;
  return {
    category,
    name,
    usercode,
    password,
    paymentStatus,
    contestStage,
    isActive: typeof explicitActive === 'boolean' ? explicitActive : isStageOpen(stageSettings, contestStage)
  };
}

async function buildParticipantRow(clean: ReturnType<typeof cleanParticipantInput>) {
  if (!clean) return null;
  return {
    category: clean.category,
    name: clean.name,
    usercode: clean.usercode,
    password_hash: await hashPassword(clean.password),
    payment_status: clean.paymentStatus,
    contest_stage: clean.contestStage,
    is_active: clean.isActive
  };
}

async function buildRowsInSmallBatches(items: ParticipantInput[], stageSettings: StageSettings) {
  const cleaned = items.map(item => cleanParticipantInput(item, stageSettings)).filter(Boolean) as NonNullable<ReturnType<typeof cleanParticipantInput>>[];
  const rows: NonNullable<Awaited<ReturnType<typeof buildParticipantRow>>>[] = [];
  const concurrency = 8;

  for (let i = 0; i < cleaned.length; i += concurrency) {
    const chunk = cleaned.slice(i, i + concurrency);
    const built = await Promise.all(chunk.map(item => buildParticipantRow(item)));
    for (const row of built) if (row) rows.push(row);
  }

  return rows;
}

async function upsertRowsInChunks(rows: NonNullable<Awaited<ReturnType<typeof buildParticipantRow>>>[]) {
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabaseAdmin.from('participants').upsert(chunk, { onConflict: 'category,usercode' });
    if (error) return error;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  try {
    const category = request.nextUrl.searchParams.get('category');
    let query = supabaseAdmin
      .from('participants')
      .select('id,name,usercode,category,payment_status,contest_stage,is_active,login_count,last_login_at,created_at')
      .order('created_at', { ascending: false });
    if (category) query = query.eq('category', category);
    const { data, error } = await query;
    if (error) return jsonError(error.message, 500);
    return Response.json({ success: true, participants: data || [] });
  } catch (error) {
    console.error('Participants GET failed:', error);
    return jsonError('Could not load participants. Check Supabase environment variables and database connection.', 500);
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  try {
    const body = await request.json().catch(() => ({}));
    const stageSettings = await getStageOpenMap();

    if (Array.isArray(body.participants)) {
      const rows = await buildRowsInSmallBatches(body.participants as ParticipantInput[], stageSettings);
      if (!rows.length) return jsonError('No valid participants found. Check category, name, usercode and password.');

      const error = await upsertRowsInChunks(rows);
      if (error) return jsonError(error.message, 500);
      return Response.json({ success: true, imported: rows.length });
    }

    const clean = cleanParticipantInput(body as ParticipantInput, stageSettings);
    if (!clean) return jsonError('Category, name, usercode and password are required.');

    const row = await buildParticipantRow(clean);
    if (!row) return jsonError('Category, name, usercode and password are required.');

    const { data, error } = await supabaseAdmin
      .from('participants')
      .insert(row)
      .select('id,name,usercode,category,payment_status,contest_stage,is_active')
      .single();

    if (error) {
      const duplicate = error.message?.toLowerCase?.().includes('duplicate') || error.code === '23505';
      return jsonError(duplicate ? 'This usercode already exists for this category. Use a different code or delete/update the old one.' : error.message, duplicate ? 409 : 500);
    }

    return Response.json({ success: true, participant: data });
  } catch (error) {
    console.error('Participants POST failed:', error);
    return jsonError('Could not save participant because the server could not reach Supabase or the request timed out. Try saving fewer records at a time, confirm Vercel environment variables, then redeploy.', 500);
  }
}
