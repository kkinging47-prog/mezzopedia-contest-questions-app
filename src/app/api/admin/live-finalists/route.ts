import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { LIVE_FINALS_STAGE } from '@/lib/constants';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, percentage } from '@/lib/utils';
import { activeElapsedSeconds } from '@/lib/sessionTime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StageSummary = {
  score: number;
  maxScore: number;
  percentage: number;
  timeUsedSeconds: number;
  submittedAt: string;
  status: string;
};

function pickField(row: any, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return fallback;
}

function submittedTime(value?: string) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function bestStageSession(a: any, b: any) {
  const aCompleted = a?.status === 'completed';
  const bCompleted = b?.status === 'completed';
  if (aCompleted !== bCompleted) return aCompleted ? -1 : 1;

  const scoreDiff = Number(b?.score || 0) - Number(a?.score || 0);
  if (scoreDiff) return scoreDiff;

  const aTime = activeElapsedSeconds(a, a?.submitted_at ? new Date(a.submitted_at) : new Date());
  const bTime = activeElapsedSeconds(b, b?.submitted_at ? new Date(b.submitted_at) : new Date());
  if (aTime !== bTime) return aTime - bTime;

  return submittedTime(b?.submitted_at) - submittedTime(a?.submitted_at);
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const category = request.nextUrl.searchParams.get('category') || 'All';

  let participantQuery = supabaseAdmin
    .from('participants')
    .select('*')
    .ilike('contest_stage', LIVE_FINALS_STAGE)
    .order('category')
    .order('name');

  if (category !== 'All') participantQuery = participantQuery.eq('category', category);

  const { data: participants, error: participantError } = await participantQuery;
  if (participantError) return jsonError(participantError.message, 500);

  const participantIds = (participants || []).map((row: any) => String(row.id || '')).filter(Boolean);
  let sessionsByParticipant = new Map<string, any[]>();

  if (participantIds.length) {
    const { data: sessions, error: sessionError } = await supabaseAdmin
      .from('contest_sessions')
      .select('id,participant_id,contest_stage,status,score,max_score,total_questions,time_used_seconds,submitted_at,started_at,updated_at,answers,answer_breakdown,question_order')
      .in('participant_id', participantIds)
      .in('contest_stage', ['Stage 1', 'Stage 2', 'Stage 3'])
      .in('status', ['completed', 'expired'])
      .not('submitted_at', 'is', null);

    if (sessionError) return jsonError(sessionError.message, 500);
    for (const session of sessions || []) {
      const id = String((session as any).participant_id || '');
      if (!id) continue;
      sessionsByParticipant.set(id, [...(sessionsByParticipant.get(id) || []), session]);
    }
  }

  const rows = (participants || []).map((participant: any, index: number) => {
    const stageScores: Record<string, StageSummary | null> = { 'Stage 1': null, 'Stage 2': null, 'Stage 3': null };
    const sessions = sessionsByParticipant.get(participant.id) || [];

    for (const stage of ['Stage 1', 'Stage 2', 'Stage 3']) {
      const stageSessions = sessions.filter(session => String(session.contest_stage || '').toLowerCase() === stage.toLowerCase());
      if (!stageSessions.length) continue;
      const best = [...stageSessions].sort(bestStageSession)[0];
      const maxScore = Number(best.max_score || best.total_questions || 0);
      const score = Number(best.score || 0);
      stageScores[stage] = {
        score,
        maxScore,
        percentage: percentage(score, maxScore),
        timeUsedSeconds: activeElapsedSeconds(best, best.submitted_at ? new Date(best.submitted_at) : new Date()),
        submittedAt: best.submitted_at || '',
        status: best.status || ''
      };
    }

    const completed = Object.values(stageScores).filter(Boolean) as StageSummary[];
    const totalScore = completed.reduce((sum, stage) => sum + stage.score, 0);
    const totalMaxScore = completed.reduce((sum, stage) => sum + stage.maxScore, 0);
    const totalTime = completed.reduce((sum, stage) => sum + stage.timeUsedSeconds, 0);

    return {
      rank: index + 1,
      participantId: participant.id,
      name: participant.name || '',
      usercode: participant.usercode || '',
      class: pickField(participant, ['class', 'class_name', 'grade', 'level'], participant.category || ''),
      category: participant.category || '',
      location: pickField(participant, ['location', 'district', 'city', 'town']),
      region: pickField(participant, ['region']),
      school: pickField(participant, ['school', 'school_name', 'institution']),
      paymentStatus: participant.payment_status || '',
      currentStage: participant.contest_stage || LIVE_FINALS_STAGE,
      stageScores,
      averageScore: completed.length ? Number((totalScore / completed.length).toFixed(2)) : 0,
      averagePercentage: percentage(totalScore, totalMaxScore),
      averageTimeSeconds: completed.length ? Math.round(totalTime / completed.length) : 0
    };
  });

  return Response.json({ success: true, stage: LIVE_FINALS_STAGE, category, rows, count: rows.length });
}
