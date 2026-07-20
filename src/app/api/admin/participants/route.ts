import { NextRequest } from 'next/server';
import { requireAdmin, hashPassword } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, normalizeContestStage, safeText } from '@/lib/utils';

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

type CleanParticipant = {
  category: string;
  name: string;
  usercode: string;
  password: string;
  paymentStatus: string;
  contestStage: string;
  isActive: boolean;
};

function normalizePaymentStatus(value: unknown) {
  const raw = safeText(value || 'unpaid').toLowerCase();
  if (raw === 'paid') return 'paid';
  if (raw === 'pending') return 'pending';
  return 'unpaid';
}

function codeKey(value: unknown) {
  return safeText(value).toLowerCase();
}

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
  const normalizedStage = normalizeContestStage(stage);
  if (!stageSettings || !stageSettings[normalizedStage]) return normalizedStage === 'Stage 1';
  return Boolean(stageSettings[normalizedStage]?.isOpen);
}

function cleanParticipantInput(item: ParticipantInput, stageSettings: StageSettings) {
  const category = safeText(item.category);
  const name = safeText(item.name);
  const usercode = safeText(item.usercode);
  const password = safeText(item.password);
  const contestStage = normalizeContestStage(item.contestStage || item.contest_stage || 'Final Trial');
  const paymentStatus = normalizePaymentStatus(item.paymentStatus || item.payment_status || 'unpaid');
  if (!category || !name || !usercode || !password) return null;
  const explicitActive = item.isActive ?? item.is_active;
  return { category, name, usercode, password, paymentStatus, contestStage, isActive: typeof explicitActive === 'boolean' ? explicitActive : isStageOpen(stageSettings, contestStage) };
}

async function buildParticipantRow(clean: CleanParticipant) {
  return {
    category: clean.category,
    name: clean.name,
    usercode: clean.usercode,
    password_hash: await hashPassword(clean.password),
    payment_status: clean.paymentStatus,
    contest_stage: clean.contestStage,
    is_active: clean.isActive,
    updated_at: new Date().toISOString()
  };
}

async function findExistingByUsercode(usercode: string) {
  const { data, error } = await supabaseAdmin
    .from('participants')
    .select('id,name,usercode,category,payment_status,contest_stage,is_active')
    .ilike('usercode', usercode)
    .limit(10);
  return { data: data || [], error };
}

function duplicatePayload(rows: any[]) {
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    usercode: row.usercode,
    category: row.category,
    paymentStatus: row.payment_status,
    contestStage: normalizeContestStage(row.contest_stage || 'Stage 1')
  }));
}

async function importParticipants(items: ParticipantInput[], stageSettings: StageSettings, importMode: string) {
  const cleaned = items.map(item => cleanParticipantInput(item, stageSettings)).filter(Boolean) as CleanParticipant[];
  if (!cleaned.length) return { error: 'No valid participants found. Check category, name, usercode and password.' };

  const seen = new Set<string>();
  const duplicateRowsInFile: string[] = [];
  for (const row of cleaned) {
    const key = codeKey(row.usercode);
    if (seen.has(key)) duplicateRowsInFile.push(row.usercode);
    seen.add(key);
  }
  if (duplicateRowsInFile.length) {
    return { error: `Duplicate usercode(s) found inside the uploaded file: ${Array.from(new Set(duplicateRowsInFile)).join(', ')}. Make each code unique, then upload again.` };
  }

  const { data: existingRows, error: readError } = await supabaseAdmin
    .from('participants')
    .select('id,name,usercode,category,payment_status,contest_stage,is_active');
  if (readError) return { error: readError.message };

  const existingByCode = new Map<string, any[]>();
  for (const row of existingRows || []) {
    const key = codeKey(row.usercode);
    existingByCode.set(key, [...(existingByCode.get(key) || []), row]);
  }

  let inserted = 0;
  let updated = 0;
  let skippedExisting = 0;
  const skippedDuplicates: string[] = [];
  const mode = importMode === 'addOnly' ? 'addOnly' : 'mergeUpdate';

  for (const clean of cleaned) {
    const existing = existingByCode.get(codeKey(clean.usercode)) || [];
    if (existing.length > 1) {
      skippedDuplicates.push(clean.usercode);
      continue;
    }

    const row = await buildParticipantRow(clean);
    if (existing.length === 1) {
      if (mode === 'addOnly') {
        skippedExisting += 1;
        continue;
      }
      const { error } = await supabaseAdmin.from('participants').update(row).eq('id', existing[0].id);
      if (error) return { error: error.message };
      updated += 1;
      continue;
    }

    const { error } = await supabaseAdmin.from('participants').insert({ ...row, created_at: new Date().toISOString() });
    if (error) return { error: error.message };
    inserted += 1;
  }

  return { imported: inserted + updated, inserted, updated, skippedExisting, skippedDuplicates };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);
  try {
    const category = request.nextUrl.searchParams.get('category');
    const search = safeText(request.nextUrl.searchParams.get('search'));
    let query = supabaseAdmin.from('participants').select('id,name,usercode,category,payment_status,contest_stage,is_active,login_count,last_login_at,created_at').order('created_at', { ascending: false });
    if (category && category !== 'All') query = query.eq('category', category);
    if (search) query = query.or(`name.ilike.%${search}%,usercode.ilike.%${search}%,category.ilike.%${search}%`);
    const { data, error } = await query;
    if (error) return jsonError(error.message, 500);
    const participants = (data || []).map((p: any) => ({ ...p, contest_stage: normalizeContestStage(p.contest_stage || 'Stage 1') }));
    return Response.json({ success: true, participants });
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
      const result = await importParticipants(body.participants as ParticipantInput[], stageSettings, String(body.importMode || 'mergeUpdate'));
      if ('error' in result && result.error) return jsonError(result.error, 409);
      return Response.json({ success: true, ...result, imported: result.imported || 0 });
    }

    const clean = cleanParticipantInput(body as ParticipantInput, stageSettings);
    if (!clean) return jsonError('Category, name, usercode and password are required.');

    const existing = await findExistingByUsercode(clean.usercode);
    if (existing.error) return jsonError(existing.error.message, 500);
    if (existing.data.length) {
      return Response.json({
        success: false,
        duplicate: true,
        error: 'This usercode already exists. Search for the existing participant and edit/update that record instead of creating another copy.',
        duplicates: duplicatePayload(existing.data)
      }, { status: 409 });
    }

    const row = await buildParticipantRow(clean);
    const { data, error } = await supabaseAdmin.from('participants').insert(row).select('id,name,usercode,category,payment_status,contest_stage,is_active').single();
    if (error) {
      const duplicate = error.message?.toLowerCase?.().includes('duplicate') || error.code === '23505';
      return jsonError(duplicate ? 'This usercode already exists. Search for the existing participant and edit/update that record.' : error.message, duplicate ? 409 : 500);
    }
    return Response.json({ success: true, participant: data });
  } catch (error) {
    console.error('Participants POST failed:', error);
    return jsonError('Could not save participant because the server could not reach Supabase or the request timed out. Try saving fewer records at a time, confirm Vercel environment variables, then redeploy.', 500);
  }
}
