import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { FINAL_TRIAL_STAGE } from '@/lib/constants';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';
import { normalizeStageSettings } from '@/lib/stageAccess';

const TARGET_STAGE = 'Stage 1';

async function readStageSettings() {
  const { data } = await supabaseAdmin
    .from('app_config')
    .select('key,value')
    .in('key', ['activePhase', 'stageSettings']);

  let activePhase = TARGET_STAGE;
  let stageSettings = normalizeStageSettings({});
  for (const row of data || []) {
    if (row.key === 'activePhase') activePhase = String(row.value || TARGET_STAGE);
    if (row.key === 'stageSettings') stageSettings = normalizeStageSettings(row.value);
  }
  return { activePhase, stageSettings };
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const now = new Date().toISOString();
  const { stageSettings } = await readStageSettings();
  const nextSettings = normalizeStageSettings(stageSettings);
  nextSettings[TARGET_STAGE] = {
    ...nextSettings[TARGET_STAGE],
    isOpen: true,
    updatedAt: now,
    note: 'Stage 1 is open for paid candidates assigned directly from the admin quick action.'
  };

  const { error: configError } = await supabaseAdmin.from('app_config').upsert([
    { key: 'activePhase', value: TARGET_STAGE },
    { key: 'stageSettings', value: nextSettings }
  ], { onConflict: 'key' });
  if (configError) return jsonError(configError.message, 500);

  const { data: paidParticipants, error: readError } = await supabaseAdmin
    .from('participants')
    .select('id,name,usercode,category,payment_status,contest_stage')
    .ilike('payment_status', 'paid');
  if (readError) return jsonError(readError.message, 500);

  const participantIds = (paidParticipants || []).map((row: any) => row.id).filter(Boolean);
  if (!participantIds.length) {
    await supabaseAdmin.from('admin_audit_logs').insert({
      action: 'ASSIGN_PAID_TO_STAGE_1',
      entity_type: 'participant',
      details: { count: 0, note: 'No paid participants were found.' }
    }).then(() => null);
    return Response.json({ success: true, assignedCount: 0, cancelledSessionCount: 0, targetStage: TARGET_STAGE });
  }

  const { data: updatedRows, error: participantError } = await supabaseAdmin
    .from('participants')
    .update({
      contest_stage: TARGET_STAGE,
      is_active: true,
      login_count: 0,
      last_login_at: null,
      updated_at: now
    })
    .in('id', participantIds)
    .select('id');
  if (participantError) return jsonError(participantError.message, 500);

  const { data: cancelledRows } = await supabaseAdmin
    .from('contest_sessions')
    .update({
      status: 'cancelled',
      active_login_token: null,
      active_user_agent: null,
      last_reauth_at: null,
      updated_at: now,
      proctoring_summary: { cancelledForPaidStageOneAssignment: true, assignedStage: TARGET_STAGE }
    })
    .in('participant_id', participantIds)
    .eq('status', 'in_progress')
    .select('id')
    .then(result => result);

  await supabaseAdmin.from('admin_audit_logs').insert({
    action: 'ASSIGN_PAID_TO_STAGE_1',
    entity_type: 'participant',
    details: {
      targetStage: TARGET_STAGE,
      assignedCount: updatedRows?.length || participantIds.length,
      cancelledSessionCount: cancelledRows?.length || 0,
      previousTrialStage: FINAL_TRIAL_STAGE,
      note: 'All paid participant codes were moved to Stage 1, opened, login counts reset, and unfinished active sessions cancelled. Unpaid and pending participants were not changed.'
    }
  }).then(() => null);

  return Response.json({
    success: true,
    assignedCount: updatedRows?.length || participantIds.length,
    cancelledSessionCount: cancelledRows?.length || 0,
    targetStage: TARGET_STAGE
  });
}
