import { NextRequest } from 'next/server';
import { COOKIE_NAMES } from '@/lib/constants';
import { clearCookie } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, secondsBetween } from '@/lib/utils';
import { NextResponse } from 'next/server';
import { getActiveParticipantSession } from '@/lib/sessionGuard';

export async function POST(request: NextRequest) {
  const { session, error, status } = await getActiveParticipantSession(request, '*');
  if (error || !session) return jsonError(error || 'Not signed in.', status);

  const { force } = await request.json().catch(() => ({}));
  if (session.status !== 'in_progress') return jsonError('Session has already ended.', 403);

  const questionIds: string[] = session.question_order || [];
  const answers = session.answers || {};
  const unanswered = questionIds.filter(id => !answers[id]);
  const expired = new Date(session.expires_at).getTime() < Date.now();

  if (unanswered.length > 0 && !force && !expired) {
    return jsonError(`You still have ${unanswered.length} unanswered question(s).`, 400);
  }

  const { data: questions, error: qError } = await supabaseAdmin
    .from('questions')
    .select('id, correct_option_id, points')
    .in('id', questionIds);

  if (qError) return jsonError(qError.message, 500);

  let score = 0;
  let maxScore = 0;
  const breakdown: Record<string, { selected?: string; correct: string; isCorrect: boolean; points: number }> = {};

  for (const q of questions || []) {
    const points = Number(q.points || 1);
    maxScore += points;
    const selected = answers[q.id];
    const isCorrect = String(selected || '') === String(q.correct_option_id);
    if (isCorrect) score += points;
    breakdown[q.id] = { selected, correct: q.correct_option_id, isCorrect, points };
  }

  const submittedAt = new Date().toISOString();
  const timeUsedSeconds = secondsBetween(session.started_at, submittedAt);

  const { data: events } = await supabaseAdmin
    .from('proctoring_events')
    .select('event_type,severity')
    .eq('session_id', session.id);

  const proctoringSummary = summarizeProctoring(events || []);

  const { error: updateError } = await supabaseAdmin
    .from('contest_sessions')
    .update({
      status: 'completed',
      submitted_at: submittedAt,
      time_used_seconds: timeUsedSeconds,
      score,
      max_score: maxScore,
      total_questions: questionIds.length,
      answer_breakdown: breakdown,
      proctoring_summary: proctoringSummary
    })
    .eq('id', session.id);

  if (updateError) return jsonError(updateError.message, 500);

  const response = NextResponse.json({ success: true, score, maxScore, totalQuestions: questionIds.length });
  clearCookie(response, COOKIE_NAMES.participant);
  return response;
}

function summarizeProctoring(events: Array<{ event_type: string; severity: string }>) {
  const total = events.length;
  const critical = events.filter(e => e.severity === 'critical').length;
  const high = events.filter(e => e.severity === 'high').length;
  const byType = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.event_type] = (acc[event.event_type] || 0) + 1;
    return acc;
  }, {});

  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
  if (critical > 0 || total >= 10) riskLevel = 'CRITICAL';
  else if (high > 0 || total >= 5) riskLevel = 'HIGH';
  else if (total > 0) riskLevel = 'MEDIUM';

  return { total, critical, high, byType, riskLevel };
}
