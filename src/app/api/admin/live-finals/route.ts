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

const RETURN_STAGES = new Set(['Stage 1', 'Stage 2', 'Stage 3']);

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

function cleanParticipantIds(value: unknown) {
  const values = Array.isArray(value) ? value : [];
  return Array.from(new Set(values.map(item => String(item || '').trim()).filter(Boolean)));
}

function safeReturnStage(value: unknown) {
  const stage = normalizeContestStage(value || 'Stage 3');
  return RETURN_STAGES.has(stage) ? stage : 'Stage 3';
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
  const action = String(body.action || 'setVisibility');
  const now = new Date().toISOString();

  if (action === 'removeFromLiveFinals') {
    const participantIds = cleanParticipantIds(body.participantIds);
    if (!participantIds.length) return jsonError('Select at least one Live Finals candidate to remove.', 400);

    const returnStage = safeReturnStage(body.returnStage || 'Stage 3');
    const { data: removed, error: updateError } = await supabaseAdmin
      .from('participants')
      .update({
        contest_stage: returnStage,
        is_active: false,
        login_count: 0,
        last_login_at: null,
        updated_at: now
      })
      .in('id', participantIds)
      .ilike('contest_stage', LIVE_FINALS_STAGE)
      .select('id,name,usercode,category');

    if (updateError) return jsonError(updateError.message, 500);
    const removedIds = (removed || []).map((row: any) => row.id).filter(Boolean);

    if (removedIds.length) {
      await supabaseAdmin
        .from('contest_sessions')
        .update({
          status: 'cancelled',
          active_login_token: null,
          active_user_agent: null,
          last_reauth_at: null,
          updated_at: now,
          proctoring_summary: { cancelledForLiveFinalsRemoval: true, returnedToStage: returnStage }
        })
        .in('participant_id', removedIds)
        .eq('contest_stage', LIVE_FINALS_STAGE)
        .eq('status', 'in_progress')
        .then(() => null);
    }

    await supabaseAdmin.from('admin_audit_logs').insert({
      action: 'REMOVE_FROM_LIVE_FINALS',
      entity_type: 'participant',
      details: {
        participantIds: removedIds,
        requestedCount: participantIds.length,
        removedCount: removedIds.length,
        returnedToStage: returnStage,
        updatedBy: admin.email,
        note: 'Candidate(s) were removed from Live Finals and returned to an earlier stage so the public results page will no longer show Live Finals promotion for them.'
      }
    }).then(() => null);

    const visibility = await readVisibility();
    const finalists = await finalistRows();
    return Response.json({
      success: true,
      action,
      removedCount: removedIds.length,
      requestedCount: participantIds.length,
      returnedToStage: returnStage,
      settings: visibility.settings,
      finalistCount: finalists.rows.length,
      finalists: finalists.rows
    });
  }

  const isOpen = Boolean(body.isOpen ?? body.open ?? body.resultsOpen ?? body.visible);
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
