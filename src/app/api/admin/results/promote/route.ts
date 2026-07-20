import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { CONTEST_STAGES, MAIN_CONTEST_STAGES } from '@/lib/constants';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, normalizeContestStage } from '@/lib/utils';

type StageName = (typeof CONTEST_STAGES)[number];

function stageIndex(stage: string) {
  return CONTEST_STAGES.indexOf(stage as StageName);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function cleanSessionIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return unique(value.map(item => String(item || '').trim()).filter(Boolean));
}

function namesFor(rows: any[]) {
  return rows.map(row => row.participant?.name || row.participant?.usercode || row.id).filter(Boolean).slice(0, 8).join(', ');
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const sessionIds = cleanSessionIds(body.sessionIds);
  const targetStage = normalizeContestStage(body.targetStage || body.toStage || '');
  const now = new Date().toISOString();

  if (!sessionIds.length) return jsonError('Select one or more completed results to promote.', 400);
  if (!(MAIN_CONTEST_STAGES as readonly string[]).includes(targetStage)) {
    return jsonError('Promote candidates only to Stage 1, Stage 2 or Stage 3.', 400);
  }

  const { data: sessions, error } = await supabaseAdmin
    .from('contest_sessions')
    .select('id,participant_id,contest_stage,status,score,time_used_seconds, participant:participants(id,name,usercode,category,payment_status,contest_stage,is_active)')
    .in('id', sessionIds);

  if (error) return jsonError(error.message, 500);
  if (!sessions || sessions.length !== sessionIds.length) return jsonError('Some selected result records could not be found. Refresh and try again.', 404);

  const duplicateParticipantIds = new Set<string>();
  const seenParticipantIds = new Set<string>();
  for (const row of sessions as any[]) {
    const participantId = String(row.participant_id || row.participant?.id || '');
    if (!participantId) continue;
    if (seenParticipantIds.has(participantId)) duplicateParticipantIds.add(participantId);
    seenParticipantIds.add(participantId);
  }
  if (duplicateParticipantIds.size) {
    return jsonError('Select only one completed result per participant before promoting.', 400);
  }

  const notCompleted = (sessions as any[]).filter(row => row.status !== 'completed');
  if (notCompleted.length) {
    return jsonError(`Some selected candidates have already been promoted/archived and cannot be promoted again from the same result: ${namesFor(notCompleted)}.`, 400);
  }

  const backwardOrSame = (sessions as any[]).filter(row => stageIndex(targetStage) <= stageIndex(normalizeContestStage(row.contest_stage || 'Stage 1')));
  if (backwardOrSame.length) {
    return jsonError(`Promotion must move forward only. Check the target stage for: ${namesFor(backwardOrSame)}.`, 400);
  }

  const alreadyAhead = (sessions as any[]).filter(row => {
    const currentStage = normalizeContestStage(row.participant?.contest_stage || row.contest_stage || 'Stage 1');
    return stageIndex(currentStage) > stageIndex(targetStage);
  });
  if (alreadyAhead.length) {
    return jsonError(`Some candidates are already beyond the selected target stage: ${namesFor(alreadyAhead)}.`, 400);
  }

  const participantIds = unique((sessions as any[]).map(row => String(row.participant_id || row.participant?.id || '')).filter(Boolean));
  if (!participantIds.length) return jsonError('No participant records were found for the selected results.', 400);

  const { data: targetSessions, error: targetError } = await supabaseAdmin
    .from('contest_sessions')
    .select('id,participant_id,status,contest_stage')
    .in('participant_id', participantIds)
    .eq('contest_stage', targetStage)
    .in('status', ['in_progress', 'completed']);
  if (targetError) return jsonError(targetError.message, 500);
  if (targetSessions && targetSessions.length) {
    const blockedIds = unique((targetSessions as any[]).map(row => String(row.participant_id || '')));
    const blockedRows = (sessions as any[]).filter(row => blockedIds.includes(String(row.participant_id || row.participant?.id || '')));
    return jsonError(`Some candidates already have an active or completed ${targetStage} session: ${namesFor(blockedRows)}.`, 400);
  }

  const completedSessionIds = (sessions as any[]).map(row => String(row.id));
  const fromStages = unique((sessions as any[]).map(row => normalizeContestStage(row.contest_stage || 'Stage 1')));
  const unpaidCount = (sessions as any[]).filter(row => row.participant?.payment_status !== 'paid').length;

  const { error: archiveError } = await supabaseAdmin
    .from('contest_sessions')
    .update({ status: 'expired', updated_at: now })
    .in('id', completedSessionIds);
  if (archiveError) return jsonError(archiveError.message, 500);

  const { error: participantError } = await supabaseAdmin
    .from('participants')
    .update({ contest_stage: targetStage, is_active: true, login_count: 0, last_login_at: null, updated_at: now })
    .in('id', participantIds);
  if (participantError) return jsonError(participantError.message, 500);

  await supabaseAdmin
    .from('contest_sessions')
    .update({ status: 'cancelled', active_login_token: null, active_user_agent: null, last_reauth_at: null, updated_at: now })
    .in('participant_id', participantIds)
    .eq('status', 'in_progress')
    .then(() => null);

  await supabaseAdmin.from('admin_audit_logs').insert({
    action: 'PROMOTE_FROM_RESULTS_PAGE',
    entity_type: 'participant',
    details: {
      targetStage,
      fromStages,
      participantIds,
      completedSessionIds,
      count: participantIds.length,
      unpaidCount,
      note: 'Selected completed results were archived as expired and participant codes were moved to the selected next stage. Payment status rules still apply at login.'
    }
  }).then(() => null);

  return Response.json({
    success: true,
    promotedCount: participantIds.length,
    targetStage,
    fromStages,
    unpaidCount,
    note: unpaidCount ? 'Some promoted candidates are not paid yet. They remain blocked from main-stage login until their payment status is paid.' : ''
  });
}
