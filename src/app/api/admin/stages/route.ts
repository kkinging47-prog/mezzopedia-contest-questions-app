import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { CONTEST_STAGES, FINAL_TRIAL_STAGE } from '@/lib/constants';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, normalizeContestStage, percentage } from '@/lib/utils';
import { getStageAccess, normalizeStageSettings, StageSettings } from '@/lib/stageAccess';

type StageName = (typeof CONTEST_STAGES)[number];

function stageIndex(stage: string) {
  return CONTEST_STAGES.indexOf(stage as StageName);
}

function normalizeStage(stage: unknown) {
  return normalizeContestStage(stage);
}

function cleanScheduleDate(value: unknown) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

async function normalizeStoredStageValues() {
  for (const stage of CONTEST_STAGES) {
    await supabaseAdmin.from('participants').update({ contest_stage: stage }).ilike('contest_stage', stage).then(() => null);
    await supabaseAdmin.from('contest_sessions').update({ contest_stage: stage }).ilike('contest_stage', stage).then(() => null);
    await supabaseAdmin.from('questions').update({ phase: stage }).ilike('phase', stage).then(() => null);
  }
}

async function readStageConfig() {
  const { data } = await supabaseAdmin.from('app_config').select('key,value').in('key', ['activePhase', 'stageSettings']);
  let activePhase = 'Stage 1';
  let stageSettings = normalizeStageSettings({});
  for (const row of data || []) {
    if (row.key === 'activePhase') activePhase = normalizeStage(row.value);
    if (row.key === 'stageSettings') stageSettings = normalizeStageSettings(row.value);
  }
  return { activePhase, stageSettings };
}

async function writeStageConfig(activePhase: string, stageSettings: StageSettings) {
  const rows = [{ key: 'activePhase', value: activePhase }, { key: 'stageSettings', value: normalizeStageSettings(stageSettings) }];
  const { error } = await supabaseAdmin.from('app_config').upsert(rows, { onConflict: 'key' });
  return error;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  await normalizeStoredStageValues();
  const selectedStage = normalizeStage(request.nextUrl.searchParams.get('stage'));
  const category = request.nextUrl.searchParams.get('category') || 'All';
  const { activePhase, stageSettings } = await readStageConfig();
  const now = new Date();

  const { data: participants, error: participantError } = await supabaseAdmin
    .from('participants')
    .select('id,name,usercode,category,payment_status,contest_stage,is_active,login_count,last_login_at')
    .order('category');
  if (participantError) return jsonError(participantError.message, 500);

  const { data: sessions, error: sessionError } = await supabaseAdmin
    .from('contest_sessions')
    .select('id,participant_id,category,contest_stage,status,started_at,submitted_at,time_used_seconds,score,max_score,total_questions, participant:participants(id,name,usercode,category,payment_status,contest_stage,is_active,login_count)')
    .in('status', ['completed', 'expired'])
    .order('submitted_at', { ascending: false, nullsFirst: false });
  if (sessionError) return jsonError(sessionError.message, 500);

  const summaries = CONTEST_STAGES.map(stage => {
    const access = getStageAccess(stageSettings, stage, now);
    const settings = stageSettings[stage] || {};
    const stageParticipants = (participants || []).filter((p: any) => normalizeStage(p.contest_stage || 'Stage 1') === stage);
    const completed = (sessions || []).filter((s: any) => normalizeStage(s.contest_stage || 'Stage 1') === stage && s.status === 'completed');
    return {
      stage,
      isOpen: access.isAccessible,
      manualOpen: Boolean(settings.isOpen),
      scheduleStatus: access.reason,
      accessMessage: access.message,
      startsAt: settings.startsAt || '',
      endsAt: settings.endsAt || '',
      note: settings.note || '',
      participantCount: stageParticipants.length,
      activeParticipantCount: stageParticipants.filter((p: any) => p.is_active).length,
      completedCount: completed.length
    };
  });

  const completedCandidates = ((sessions || []) as any[])
    .filter(row => row.status === 'completed')
    .filter(row => normalizeStage(row.contest_stage || 'Stage 1') === selectedStage)
    .filter(row => category === 'All' || row.category === category || row.participant?.category === category)
    .map(row => ({
      sessionId: row.id,
      participantId: row.participant_id,
      name: row.participant?.name || '',
      usercode: row.participant?.usercode || '',
      category: row.category || row.participant?.category || '',
      paymentStatus: row.participant?.payment_status || '',
      currentStage: normalizeStage(row.participant?.contest_stage || 'Stage 1'),
      sessionStage: normalizeStage(row.contest_stage || 'Stage 1'),
      access: row.participant?.is_active ? 'Open' : 'Closed',
      score: row.score || 0,
      maxScore: row.max_score || row.total_questions || 0,
      percentage: percentage(row.score || 0, row.max_score || row.total_questions || 0),
      timeUsedSeconds: row.time_used_seconds || 0,
      submittedAt: row.submitted_at
    }))
    .sort((a, b) => b.score - a.score || a.timeUsedSeconds - b.timeUsedSeconds || a.name.localeCompare(b.name));

  return Response.json({ success: true, activePhase, stageSettings, summaries, completedCandidates, serverNow: now.toISOString(), timeZone: 'Africa/Accra' });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  await normalizeStoredStageValues();
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '');
  const now = new Date().toISOString();

  if (action === 'setStageStatus') {
    const stage = normalizeStage(body.stage);
    const { activePhase, stageSettings } = await readStageConfig();
    const isOpen = Boolean(body.isOpen);
    const openOnlyThisStage = Boolean(body.openOnlyThisStage);

    const nextSettings = normalizeStageSettings(stageSettings);
    if (openOnlyThisStage) for (const item of CONTEST_STAGES) nextSettings[item] = { ...nextSettings[item], isOpen: item === stage, updatedAt: now };
    nextSettings[stage] = { ...nextSettings[stage], isOpen, updatedAt: now, note: isOpen ? `${stage} is open for assigned candidates within its scheduled time.` : `${stage} is closed.` };

    const nextActivePhase = isOpen ? stage : activePhase;
    const error = await writeStageConfig(nextActivePhase, nextSettings);
    if (error) return jsonError(error.message, 500);

    if (openOnlyThisStage) await supabaseAdmin.from('participants').update({ is_active: false, updated_at: now }).neq('contest_stage', stage).then(() => null);
    const { error: participantStatusError } = await supabaseAdmin.from('participants').update({ is_active: isOpen, updated_at: now }).eq('contest_stage', stage);
    if (participantStatusError) return jsonError(participantStatusError.message, 500);

    await supabaseAdmin.from('admin_audit_logs').insert({ action: isOpen ? 'OPEN_CONTEST_STAGE' : 'CLOSE_CONTEST_STAGE', entity_type: 'stage', details: { stage, isOpen, openOnlyThisStage, nextActivePhase, note: 'Stage open/close updates code access. Stage schedule can still block access before start time or after end time.' } }).then(() => null);
    return Response.json({ success: true, activePhase: nextActivePhase, stageSettings: nextSettings });
  }

  if (action === 'assignAllToTrial') {
    const { activePhase, stageSettings } = await readStageConfig();
    const nextSettings = normalizeStageSettings(stageSettings);
    nextSettings[FINAL_TRIAL_STAGE] = { ...nextSettings[FINAL_TRIAL_STAGE], isOpen: true, updatedAt: now, note: 'Final Trial is open for all assigned candidates before the main quiz.' };
    const error = await writeStageConfig(FINAL_TRIAL_STAGE, nextSettings);
    if (error) return jsonError(error.message, 500);

    const { data: participants, error: participantReadError } = await supabaseAdmin.from('participants').select('id');
    if (participantReadError) return jsonError(participantReadError.message, 500);
    const participantIds = (participants || []).map((row: any) => row.id).filter(Boolean);

    const { error: participantError } = await supabaseAdmin
      .from('participants')
      .update({ contest_stage: FINAL_TRIAL_STAGE, is_active: true, login_count: 0, last_login_at: null, updated_at: now })
      .not('id', 'is', null);
    if (participantError) return jsonError(participantError.message, 500);

    if (participantIds.length) {
      await supabaseAdmin.from('contest_sessions').update({ status: 'cancelled', active_login_token: null, active_user_agent: null, last_reauth_at: null, updated_at: now, proctoring_summary: { cancelledForFinalTrialReset: true } }).in('participant_id', participantIds).eq('status', 'in_progress').then(() => null);
    }

    await supabaseAdmin.from('admin_audit_logs').insert({ action: 'ASSIGN_ALL_TO_FINAL_TRIAL', entity_type: 'participant', details: { count: participantIds.length, previousActivePhase: activePhase, note: 'All participant codes were moved to Final Trial and opened for trial login.' } }).then(() => null);
    return Response.json({ success: true, assignedCount: participantIds.length, activePhase: FINAL_TRIAL_STAGE, stageSettings: nextSettings });
  }

  if (action === 'updateStageSchedule') {
    const stage = normalizeStage(body.stage);
    const startsAt = cleanScheduleDate(body.startsAt);
    const endsAt = cleanScheduleDate(body.endsAt);
    if (startsAt && endsAt && new Date(startsAt).getTime() >= new Date(endsAt).getTime()) return jsonError('The stage start time must be earlier than the end time.', 400);

    const { activePhase, stageSettings } = await readStageConfig();
    const nextSettings = normalizeStageSettings(stageSettings);
    nextSettings[stage] = {
      ...nextSettings[stage],
      startsAt,
      endsAt,
      updatedAt: now,
      note: startsAt || endsAt ? `${stage} has a scheduled start/end time.` : `${stage} schedule cleared.`
    };

    const error = await writeStageConfig(activePhase, nextSettings);
    if (error) return jsonError(error.message, 500);
    await supabaseAdmin.from('admin_audit_logs').insert({ action: 'UPDATE_STAGE_SCHEDULE', entity_type: 'stage', details: { stage, startsAt, endsAt, timeZone: 'Africa/Accra' } }).then(() => null);
    return Response.json({ success: true, activePhase, stageSettings: nextSettings });
  }

  if (action === 'promoteSelected') {
    const fromStage = normalizeStage(body.fromStage);
    const toStage = normalizeStage(body.toStage);
    const participantIds = Array.isArray(body.participantIds) ? body.participantIds.map((id: unknown) => String(id)).filter(Boolean) : [];
    if (!participantIds.length) return jsonError('Select one or more qualified candidates first.', 400);
    if (stageIndex(toStage) <= stageIndex(fromStage)) return jsonError('Promotion must move candidates to the next stage, not backwards.', 400);

    const { data: completedRows, error: completedError } = await supabaseAdmin.from('contest_sessions').select('id,participant_id,contest_stage,status').eq('status', 'completed').eq('contest_stage', fromStage).in('participant_id', participantIds);
    if (completedError) return jsonError(completedError.message, 500);

    const completedIds = Array.from(new Set((completedRows || []).map((row: any) => row.participant_id).filter(Boolean)));
    const completedSessionIds = Array.from(new Set((completedRows || []).map((row: any) => row.id).filter(Boolean)));
    if (!completedIds.length) return jsonError(`None of the selected candidates have completed ${fromStage}.`, 400);

    const { error: archiveError } = await supabaseAdmin.from('contest_sessions').update({ status: 'expired', updated_at: now, proctoring_summary: { promotedFromStage: fromStage, promotedToStage: toStage, archivedForNextStageLogin: true } }).in('id', completedSessionIds);
    if (archiveError) return jsonError(archiveError.message, 500);

    const { error: participantError } = await supabaseAdmin.from('participants').update({ contest_stage: toStage, is_active: true, login_count: 0, last_login_at: null, updated_at: now }).in('id', completedIds);
    if (participantError) return jsonError(participantError.message, 500);

    await supabaseAdmin.from('contest_sessions').update({ status: 'cancelled', active_login_token: null, active_user_agent: null, last_reauth_at: null, updated_at: now }).in('participant_id', completedIds).eq('status', 'in_progress').then(() => null);
    await supabaseAdmin.from('admin_audit_logs').insert({ action: 'PROMOTE_QUALIFIED_CANDIDATES', entity_type: 'participant', details: { fromStage, toStage, participantIds: completedIds, completedSessionIds, count: completedIds.length, note: 'Previous completed stage sessions were archived as expired so the same code can begin the next assigned stage.' } }).then(() => null);
    return Response.json({ success: true, promotedCount: completedIds.length, fromStage, toStage });
  }

  return jsonError('Unknown stage action.', 400);
}
