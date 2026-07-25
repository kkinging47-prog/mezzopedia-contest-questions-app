import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, normalizeContestStage, percentage } from '@/lib/utils';

type RankedResult = {
  id: string;
  participantId: string;
  category: string;
  sessionStage: string;
  currentStage: string;
  status: string;
  name: string;
  usercode: string;
  paymentStatus: string;
  isActive: boolean;
  score: number;
  maxScore: number;
  totalQuestions: number;
  percentage: number;
  timeUsedSeconds: number;
  startedAt: string;
  submittedAt: string;
  proctoringSummary: Record<string, unknown>;
  attemptCount?: number;
  hiddenAttemptCount?: number;
};

function submittedTime(value?: string) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function officialAttemptCompare(a: RankedResult, b: RankedResult) {
  const aSubmitted = submittedTime(a.submittedAt) > 0;
  const bSubmitted = submittedTime(b.submittedAt) > 0;
  if (aSubmitted !== bSubmitted) return aSubmitted ? -1 : 1;

  const scoreDiff = b.score - a.score;
  if (scoreDiff) return scoreDiff;

  const timeDiff = a.timeUsedSeconds - b.timeUsedSeconds;
  if (timeDiff) return timeDiff;

  const aCompleted = a.status === 'completed';
  const bCompleted = b.status === 'completed';
  if (aCompleted !== bCompleted) return aCompleted ? -1 : 1;

  return submittedTime(b.submittedAt) - submittedTime(a.submittedAt);
}

function rankingCompare(a: RankedResult, b: RankedResult) {
  return b.score - a.score || a.timeUsedSeconds - b.timeUsedSeconds || submittedTime(a.submittedAt) - submittedTime(b.submittedAt) || a.name.localeCompare(b.name);
}

function officialResultsOnly(results: RankedResult[]) {
  const groups = new Map<string, RankedResult[]>();
  for (const result of results) {
    const key = `${result.participantId || result.usercode}|${result.sessionStage}`;
    groups.set(key, [...(groups.get(key) || []), result]);
  }

  const official: RankedResult[] = [];
  let duplicateAttemptCount = 0;
  for (const attempts of groups.values()) {
    const sorted = attempts.sort(officialAttemptCompare);
    const best = sorted[0];
    const attemptCount = attempts.length;
    duplicateAttemptCount += Math.max(0, attemptCount - 1);
    official.push({ ...best, attemptCount, hiddenAttemptCount: Math.max(0, attemptCount - 1) });
  }

  return { official: official.sort(rankingCompare), duplicateAttemptCount };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const { data, error } = await supabaseAdmin
    .from('contest_sessions')
    .select('id,participant_id,category,contest_stage,status,started_at,submitted_at,time_used_seconds,score,max_score,total_questions,proctoring_summary, participant:participants(id,name,usercode,category,payment_status,contest_stage,is_active)')
    .in('status', ['completed', 'expired'])
    .order('score', { ascending: false, nullsFirst: false })
    .order('time_used_seconds', { ascending: true, nullsFirst: false })
    .order('submitted_at', { ascending: true, nullsFirst: false });

  if (error) return jsonError(error.message, 500);

  const allResults: RankedResult[] = (data || [])
    .map((row: any) => ({
      id: row.id,
      participantId: row.participant_id || row.participant?.id || '',
      category: row.category || row.participant?.category || '',
      sessionStage: normalizeContestStage(row.contest_stage || row.participant?.contest_stage || 'Stage 1'),
      currentStage: normalizeContestStage(row.participant?.contest_stage || row.contest_stage || 'Stage 1'),
      status: row.status,
      name: row.participant?.name || '',
      usercode: row.participant?.usercode || '',
      paymentStatus: row.participant?.payment_status || '',
      isActive: Boolean(row.participant?.is_active),
      score: row.score || 0,
      maxScore: row.max_score || row.total_questions || 0,
      totalQuestions: row.total_questions || 0,
      percentage: percentage(row.score || 0, row.max_score || row.total_questions || 0),
      timeUsedSeconds: row.time_used_seconds || 0,
      startedAt: row.started_at,
      submittedAt: row.submitted_at,
      proctoringSummary: row.proctoring_summary || {}
    }));

  const { official, duplicateAttemptCount } = officialResultsOnly(allResults);

  return Response.json({
    success: true,
    results: official,
    allSessionCount: allResults.length,
    duplicateAttemptCount,
    defaultOrder: 'highest_score_then_least_time',
    dedupeRule: 'One official row is shown per participant per completed stage. Extra saved attempts are counted but hidden from ranking.'
  });
}
