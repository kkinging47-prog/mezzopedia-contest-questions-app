import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, normalizeContestStage, percentage } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SessionRow = {
  id: string;
  participant_id: string;
  status: string;
  contest_stage: string;
  started_at?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;
  score?: number | null;
  max_score?: number | null;
  total_questions?: number | null;
  time_used_seconds?: number | null;
};

function isPaid(value: unknown) {
  return String(value || '').trim().toLowerCase() === 'paid';
}

function timeValue(value?: string | null) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function latestSession(sessions: SessionRow[]) {
  return [...sessions].sort((a, b) => timeValue(b.submitted_at || b.updated_at || b.started_at) - timeValue(a.submitted_at || a.updated_at || a.started_at))[0] || null;
}

function classifyStageParticipation(sessions: SessionRow[]) {
  const completed = sessions.filter(session => session.status === 'completed' && session.submitted_at);
  if (completed.length) return { status: 'completed', label: 'Completed / submitted', didSubmit: true, didStart: true, officialSession: latestSession(completed) };

  const archivedSubmitted = sessions.filter(session => session.status === 'expired' && session.submitted_at);
  if (archivedSubmitted.length) return { status: 'archived_submitted', label: 'Submitted but archived/promoted', didSubmit: true, didStart: true, officialSession: latestSession(archivedSubmitted) };

  const inProgress = sessions.filter(session => session.status === 'in_progress');
  if (inProgress.length) return { status: 'in_progress', label: 'Started but not submitted yet', didSubmit: false, didStart: true, officialSession: latestSession(inProgress) };

  const expired = sessions.filter(session => session.status === 'expired');
  if (expired.length) return { status: 'timed_out_or_not_submitted', label: 'Timed out / not submitted', didSubmit: false, didStart: true, officialSession: latestSession(expired) };

  return { status: 'did_not_start', label: 'Did not start this stage', didSubmit: false, didStart: false, officialSession: null };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const stage = normalizeContestStage(request.nextUrl.searchParams.get('stage') || 'Stage 1');
  const category = request.nextUrl.searchParams.get('category') || 'All';

  let participantQuery = supabaseAdmin
    .from('participants')
    .select('id,name,usercode,category,payment_status,contest_stage,is_active,login_count,last_login_at')
    .ilike('payment_status', 'paid')
    .order('category')
    .order('name');

  if (category && category !== 'All') participantQuery = participantQuery.eq('category', category);

  const { data: participants, error: participantError } = await participantQuery;
  if (participantError) return jsonError(participantError.message, 500);

  const { data: sessions, error: sessionError } = await supabaseAdmin
    .from('contest_sessions')
    .select('id,participant_id,status,contest_stage,started_at,submitted_at,updated_at,score,max_score,total_questions,time_used_seconds')
    .ilike('contest_stage', stage)
    .in('status', ['completed', 'expired', 'in_progress'])
    .order('updated_at', { ascending: false, nullsFirst: false });

  if (sessionError) return jsonError(sessionError.message, 500);

  const sessionsByParticipant = new Map<string, SessionRow[]>();
  for (const session of (sessions || []) as SessionRow[]) {
    const id = String(session.participant_id || '');
    if (!id) continue;
    sessionsByParticipant.set(id, [...(sessionsByParticipant.get(id) || []), session]);
  }

  const rows = (participants || []).filter((participant: any) => isPaid(participant.payment_status)).map((participant: any) => {
    const participantSessions = sessionsByParticipant.get(participant.id) || [];
    const participation = classifyStageParticipation(participantSessions);
    const official = participation.officialSession;
    const maxScore = Number(official?.max_score || official?.total_questions || 0);
    const score = Number(official?.score || 0);

    return {
      participantId: participant.id,
      name: participant.name || '',
      usercode: participant.usercode || '',
      category: participant.category || '',
      paymentStatus: participant.payment_status || 'paid',
      currentStage: normalizeContestStage(participant.contest_stage || 'Stage 1'),
      isActive: Boolean(participant.is_active),
      loginCount: Number(participant.login_count || 0),
      lastLoginAt: participant.last_login_at || '',
      checkedStage: stage,
      participationStatus: participation.status,
      participationLabel: participation.label,
      didStart: participation.didStart,
      didSubmit: participation.didSubmit,
      attemptCount: participantSessions.length,
      latestSessionId: official?.id || '',
      latestSessionStatus: official?.status || '',
      startedAt: official?.started_at || '',
      submittedAt: official?.submitted_at || '',
      updatedAt: official?.updated_at || '',
      score,
      maxScore,
      percentage: percentage(score, maxScore),
      timeUsedSeconds: Number(official?.time_used_seconds || 0)
    };
  });

  const stats = rows.reduce((acc: Record<string, number>, row: any) => {
    acc.paid += 1;
    acc[row.participationStatus] = (acc[row.participationStatus] || 0) + 1;
    if (!row.didSubmit) acc.notSubmitted += 1;
    if (!row.didStart) acc.didNotStart += 1;
    if (row.didSubmit) acc.submitted += 1;
    return acc;
  }, { paid: 0, submitted: 0, notSubmitted: 0, didNotStart: 0, completed: 0, archived_submitted: 0, in_progress: 0, timed_out_or_not_submitted: 0, did_not_start: 0 });

  return Response.json({ success: true, stage, category, rows, stats });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '');
  const stage = normalizeContestStage(body.stage || 'Stage 1');
  const participantIds = Array.isArray(body.participantIds)
    ? Array.from(new Set(body.participantIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)))
    : [];

  if (action !== 'reopenSelectedForStage') return jsonError('Unknown participation action.', 400);
  if (!participantIds.length) return jsonError('Select at least one paid participant first.', 400);

  const { data: participants, error: participantError } = await supabaseAdmin
    .from('participants')
    .select('id,name,usercode,category,payment_status')
    .in('id', participantIds);

  if (participantError) return jsonError(participantError.message, 500);

  const paidParticipants = (participants || []).filter((participant: any) => isPaid(participant.payment_status));
  const paidIds = paidParticipants.map((participant: any) => participant.id).filter(Boolean);
  if (!paidIds.length) return jsonError('None of the selected participants are marked as paid.', 400);

  const now = new Date().toISOString();

  const { data: targetSessions } = await supabaseAdmin
    .from('contest_sessions')
    .select('id,participant_id,status,contest_stage')
    .in('participant_id', paidIds)
    .ilike('contest_stage', stage)
    .in('status', ['completed', 'in_progress']);

  const targetSessionIds = (targetSessions || []).map((session: any) => session.id).filter(Boolean);
  if (targetSessionIds.length) {
    const { error: archiveTargetError } = await supabaseAdmin
      .from('contest_sessions')
      .update({ status: 'expired', updated_at: now })
      .in('id', targetSessionIds);
    if (archiveTargetError) return jsonError(archiveTargetError.message, 500);
  }

  const { data: otherActiveSessions } = await supabaseAdmin
    .from('contest_sessions')
    .select('id,participant_id,status,contest_stage')
    .in('participant_id', paidIds)
    .eq('status', 'in_progress');

  const otherActiveIds = (otherActiveSessions || []).map((session: any) => session.id).filter(Boolean);
  if (otherActiveIds.length) {
    const { error: archiveActiveError } = await supabaseAdmin
      .from('contest_sessions')
      .update({ status: 'expired', updated_at: now })
      .in('id', otherActiveIds);
    if (archiveActiveError) return jsonError(archiveActiveError.message, 500);
  }

  const { error: updateError } = await supabaseAdmin
    .from('participants')
    .update({ contest_stage: stage, is_active: true, login_count: 0, last_login_at: null, updated_at: now })
    .in('id', paidIds);

  if (updateError) return jsonError(updateError.message, 500);

  await supabaseAdmin.from('admin_audit_logs').insert({
    action: 'REOPEN_SELECTED_PAID_STAGE',
    entity_type: 'participant',
    details: {
      stage,
      requestedCount: participantIds.length,
      reopenedCount: paidIds.length,
      archivedTargetStageSessions: targetSessionIds.length,
      archivedOtherActiveSessions: otherActiveIds.length,
      participants: paidParticipants.map((participant: any) => ({ id: participant.id, name: participant.name, usercode: participant.usercode, category: participant.category }))
    }
  }).then(() => null);

  return Response.json({
    success: true,
    stage,
    reopenedCount: paidIds.length,
    archivedTargetStageSessions: targetSessionIds.length,
    archivedOtherActiveSessions: otherActiveIds.length,
    skippedUnpaidCount: participantIds.length - paidIds.length,
    note: `${paidIds.length} paid participant code(s) have been assigned to ${stage} and opened. Make sure ${stage} is open and its time schedule has not ended.`
  });
}
