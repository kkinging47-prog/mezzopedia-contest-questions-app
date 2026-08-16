import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { LIVE_FINALS_STAGE } from '@/lib/constants';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, normalizeContestStage } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LiveFinalsVisibility = {
  isOpen?: boolean;
  resultsOpen?: boolean;
  visible?: boolean;
  openedAt?: string;
  closedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  note?: string;
};

function normalizeVisibility(value: unknown): Required<LiveFinalsVisibility> {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as LiveFinalsVisibility : {};
  const isOpen = Boolean(raw.isOpen || raw.resultsOpen || raw.visible);
  return {
    isOpen,
    resultsOpen: isOpen,
    visible: isOpen,
    openedAt: raw.openedAt || '',
    closedAt: raw.closedAt || '',
    updatedAt: raw.updatedAt || '',
    updatedBy: raw.updatedBy || '',
    note: raw.note || 'Controls whether candidates can see Live Finals promotion status on the public results page.'
  };
}

async function readVisibility() {
  const { data, error } = await supabaseAdmin
    .from('app_config')
    .select('value')
    .eq('key', 'liveFinalsVisibility')
    .maybeSingle();
  if (error) return { settings: normalizeVisibility({}), error };
  return { settings: normalizeVisibility(data?.value), error: null };
}

async function finalistRows() {
  const { data, error } = await supabaseAdmin
    .from('participants')
    .select('id,name,usercode,category,payment_status,contest_stage,is_active,login_count,last_login_at')
    .ilike('contest_stage', LIVE_FINALS_STAGE)
    .order('category')
    .order('name');
  if (error) return { rows: [], error };
  return {
    rows: (data || []).map((row: any) => ({
      id: row.id,
      name: row.name || '',
      usercode: row.usercode || '',
      category: row.category || '',
      paymentStatus: row.payment_status || '',
      currentStage: normalizeContestStage(row.contest_stage || LIVE_FINALS_STAGE),
      isActive: Boolean(row.is_active),
      loginCount: Number(row.login_count || 0),
      lastLoginAt: row.last_login_at || ''
    })),
    error: null
  };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const visibility = await readVisibility();
  if (visibility.error) return jsonError(visibility.error.message, 500);

  const finalists = await finalistRows();
  if (finalists.error) return jsonError(finalists.error.message, 500);

  return Response.json({
    success: true,
    settings: visibility.settings,
    finalistCount: finalists.rows.length,
    finalists: finalists.rows
  });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const isOpen = Boolean(body.isOpen ?? body.open ?? body.resultsOpen ?? body.visible);
  const now = new Date().toISOString();
  const settings = normalizeVisibility({
    isOpen,
    resultsOpen: isOpen,
    visible: isOpen,
    openedAt: isOpen ? now : '',
    closedAt: isOpen ? '' : now,
    updatedAt: now,
    updatedBy: admin.email,
    note: isOpen
      ? 'Live Finals promotion status is released on the public results page.'
      : 'Live Finals promotion status is hidden from the public results page.'
  });

  const { error } = await supabaseAdmin
    .from('app_config')
    .upsert([{ key: 'liveFinalsVisibility', value: settings }], { onConflict: 'key' });
  if (error) return jsonError(error.message, 500);

  await supabaseAdmin.from('admin_audit_logs').insert({
    action: isOpen ? 'OPEN_LIVE_FINALS_RESULTS_VISIBILITY' : 'CLOSE_LIVE_FINALS_RESULTS_VISIBILITY',
    entity_type: 'results_visibility',
    details: {
      isOpen,
      updatedBy: admin.email,
      note: 'Controls whether candidates assigned to Live Finals see the Live Finals promotion banner when checking results.'
    }
  }).then(() => null);

  const finalists = await finalistRows();

  return Response.json({
    success: true,
    settings,
    finalistCount: finalists.rows.length,
    finalists: finalists.rows
  });
}
