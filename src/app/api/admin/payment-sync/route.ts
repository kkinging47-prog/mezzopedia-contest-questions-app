import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { requireAdmin, hashPassword } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, safeText } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type SyncPaymentStatus = 'paid' | 'pending' | 'unpaid';
type RegistrationSummary = { total: number; paid: number; pending: number; unpaid: number };

type RegistrationRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  payment_status: string | null;
  unique_code: string | null;
  password: string | null;
  stage: string | null;
  category: string | null;
  updated_at: string | null;
};

type ContestParticipant = {
  id: string;
  name: string;
  usercode: string;
  category: string;
  payment_status: string;
  contest_stage: string;
  is_active: boolean;
};

type UnmatchedRegistrant = {
  name: string;
  uniqueCode: string;
  paymentStatus: SyncPaymentStatus;
  category: string;
  stage: string;
};

function cleanEnv(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, '');
}

function normalizeSupabaseUrl(value: string | undefined) {
  const cleaned = cleanEnv(value);
  if (!cleaned) return '';
  try {
    const url = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
    const dashboardProjectMatch = url.pathname.match(/\/project\/([a-z0-9-]+)/i);
    if (url.hostname === 'supabase.com' && dashboardProjectMatch?.[1]) return `https://${dashboardProjectMatch[1]}.supabase.co`;
    if (url.hostname.endsWith('.supabase.co')) return `${url.protocol}//${url.hostname}`;
  } catch {
    // Continue with simple cleanup below.
  }
  return cleaned.replace(/\/rest\/v1.*$/i, '').replace(/\/+$/, '');
}

function registrationClient(): SupabaseClient | null {
  const url = normalizeSupabaseUrl(process.env.REGISTRATION_SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const key = cleanEnv(process.env.REGISTRATION_SUPABASE_SERVICE_ROLE_KEY || process.env.REGISTRATION_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function paymentStatus(value: unknown): SyncPaymentStatus {
  const raw = safeText(value || 'unpaid').toLowerCase();
  if (['paid', 'pay', 'complete', 'completed', 'yes', 'true', '1'].includes(raw)) return 'paid';
  if (['pending', 'processing', 'waiting'].includes(raw)) return 'pending';
  return 'unpaid';
}

function codeKey(value: unknown) {
  return safeText(value).toLowerCase();
}

async function listRegistrationRows(client: SupabaseClient) {
  const rows: RegistrationRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('registrants')
      .select('id,full_name,phone,email,payment_status,unique_code,password,stage,category,updated_at')
      .order('updated_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) return { rows, error };
    rows.push(...((data || []) as RegistrationRow[]));
    if (!data || data.length < pageSize) break;
  }
  return { rows, error: null };
}

async function listContestParticipants() {
  const { data, error } = await supabaseAdmin
    .from('participants')
    .select('id,name,usercode,category,payment_status,contest_stage,is_active')
    .order('created_at', { ascending: false });
  return { participants: (data || []) as ContestParticipant[], error };
}

function summarizeRegistrationRows(rows: RegistrationRow[]): RegistrationSummary {
  const summary: RegistrationSummary = { total: 0, paid: 0, pending: 0, unpaid: 0 };
  for (const row of rows) {
    const status = paymentStatus(row.payment_status);
    summary.total += 1;
    summary[status] += 1;
  }
  return summary;
}

function buildParticipantMap(participants: ContestParticipant[]) {
  const map = new Map<string, ContestParticipant[]>();
  for (const participant of participants) {
    const key = codeKey(participant.usercode);
    if (!key) continue;
    map.set(key, [...(map.get(key) || []), participant]);
  }
  return map;
}

function unmatchedRegistrant(registrant: RegistrationRow): UnmatchedRegistrant {
  return {
    name: registrant.full_name || '',
    uniqueCode: registrant.unique_code || '',
    paymentStatus: paymentStatus(registrant.payment_status),
    category: registrant.category || '',
    stage: registrant.stage || ''
  };
}

function basicPreview(registrants: RegistrationRow[], participants: ContestParticipant[]) {
  const participantMap = buildParticipantMap(participants);
  let matched = 0;
  let statusChanges = 0;
  let nameChanges = 0;
  let duplicateContestCodes = 0;
  const unmatched: UnmatchedRegistrant[] = [];

  for (const registrant of registrants) {
    const key = codeKey(registrant.unique_code);
    if (!key) continue;
    const matches = participantMap.get(key) || [];
    if (matches.length > 1) { duplicateContestCodes += 1; continue; }
    if (!matches.length) {
      unmatched.push(unmatchedRegistrant(registrant));
      continue;
    }
    matched += 1;
    const participant = matches[0];
    if (paymentStatus(participant.payment_status) !== paymentStatus(registrant.payment_status)) statusChanges += 1;
    if (safeText(registrant.full_name) && safeText(registrant.full_name) !== safeText(participant.name)) nameChanges += 1;
  }

  return { matched, statusChanges, nameChanges, duplicateContestCodes, unmatched: unmatched.slice(0, 100), unmatchedCount: unmatched.length };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const client = registrationClient();
  if (!client) {
    return Response.json({
      success: true,
      configured: false,
      message: 'Registration sync is not configured yet. Add REGISTRATION_SUPABASE_URL and REGISTRATION_SUPABASE_ANON_KEY or REGISTRATION_SUPABASE_SERVICE_ROLE_KEY in Vercel.'
    });
  }

  const registration = await listRegistrationRows(client);
  if (registration.error) return jsonError(`Could not read registration records: ${registration.error.message}`, 500);
  const contest = await listContestParticipants();
  if (contest.error) return jsonError(`Could not read contest participants: ${contest.error.message}`, 500);

  return Response.json({
    success: true,
    configured: true,
    registrationSummary: summarizeRegistrationRows(registration.rows),
    contestSummary: { total: contest.participants.length },
    preview: basicPreview(registration.rows, contest.participants)
  });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const client = registrationClient();
  if (!client) return jsonError('Registration sync is not configured. Add REGISTRATION_SUPABASE_URL and REGISTRATION_SUPABASE_ANON_KEY or REGISTRATION_SUPABASE_SERVICE_ROLE_KEY in Vercel.', 400);

  const body = await request.json().catch(() => ({}));
  const updateNames = body.updateNames !== false;
  const updatePasswords = body.updatePasswords === true;

  const registration = await listRegistrationRows(client);
  if (registration.error) return jsonError(`Could not read registration records: ${registration.error.message}`, 500);
  const contest = await listContestParticipants();
  if (contest.error) return jsonError(`Could not read contest participants: ${contest.error.message}`, 500);

  const participantMap = buildParticipantMap(contest.participants);
  let checked = 0;
  let matched = 0;
  let updated = 0;
  let statusUpdated = 0;
  let nameUpdated = 0;
  let passwordUpdated = 0;
  let skippedUnmatched = 0;
  let skippedDuplicateContestCodes = 0;
  const unmatched: UnmatchedRegistrant[] = [];

  for (const registrant of registration.rows) {
    const key = codeKey(registrant.unique_code);
    if (!key) continue;
    checked += 1;
    const matches = participantMap.get(key) || [];
    if (matches.length > 1) { skippedDuplicateContestCodes += 1; continue; }
    if (!matches.length) {
      skippedUnmatched += 1;
      if (unmatched.length < 100) unmatched.push(unmatchedRegistrant(registrant));
      continue;
    }

    matched += 1;
    const participant = matches[0];
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const nextPaymentStatus = paymentStatus(registrant.payment_status);
    if (paymentStatus(participant.payment_status) !== nextPaymentStatus) {
      payload.payment_status = nextPaymentStatus;
      statusUpdated += 1;
    }

    const nextName = safeText(registrant.full_name);
    if (updateNames && nextName && nextName !== safeText(participant.name)) {
      payload.name = nextName;
      nameUpdated += 1;
    }

    const nextPassword = safeText(registrant.password);
    if (updatePasswords && nextPassword) {
      payload.password_hash = await hashPassword(nextPassword);
      passwordUpdated += 1;
    }

    if (Object.keys(payload).length <= 1) continue;
    const { error } = await supabaseAdmin.from('participants').update(payload).eq('id', participant.id);
    if (error) return jsonError(error.message, 500);
    updated += 1;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    action: 'SYNC_REGISTRATION_PAYMENTS',
    entity_type: 'participant',
    details: {
      checked,
      matched,
      updated,
      statusUpdated,
      nameUpdated,
      passwordUpdated,
      skippedUnmatched,
      skippedDuplicateContestCodes,
      note: 'Synced contest participants by matching registration unique_code to contest usercode. Category/stage were not changed to avoid mismatches between the registration portal and contest stages/classes.'
    }
  }).then(() => null);

  return Response.json({
    success: true,
    checked,
    matched,
    updated,
    statusUpdated,
    nameUpdated,
    passwordUpdated,
    skippedUnmatched,
    skippedDuplicateContestCodes,
    unmatched,
    note: 'Payment status sync completed. The contest app still controls category, assigned stage and access rules.'
  });
}
