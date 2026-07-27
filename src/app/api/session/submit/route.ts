import { NextRequest } from 'next/server';
import { COOKIE_NAMES } from '@/lib/constants';
import { clearCookie } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';
import { NextResponse } from 'next/server';
import { getActiveParticipantSession } from '@/lib/sessionGuard';
import { activeElapsedSeconds, publicAnswers } from '@/lib/sessionTime';

const ROUTINE_PROCTORING_EVENTS = new Set(['TEST_SUBMISSION_ATTEMPT']);

function cleanIncomingAnswers(raw: unknown, questionIds: string[]) {
  const incoming = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const allowed = new Set(questionIds.map(String));
  const clean: Record<string, string> = {};

  for (const [rawQuestionId, rawOptionId] of Object.entries(incoming)) {
    const questionId = String(rawQuestionId);
    const optionId = String(rawOptionId || '').trim().slice(0, 12);
    if (!allowed.has(questionId) || !optionId) continue;
    clean[questionId] = optionId;
  }

  return clean;
}

function completedResponse(session: any, alreadyCompleted = false) {
  const response = NextResponse.json({
    success: true,
    alreadyCompleted,
    score: session.score || 0,
    maxScore: session.max_score || session.total_questions || 0,
    totalQuestions: session.total_questions || 0
  });
  clearCookie(response, COOKIE_NAMES.participant);
  return response;
}

export async function POST(request: NextRequest) {
  const { session, error, status } = await getActiveParticipantSession(request, '*');
  if (error || !session) return jsonError(error || 'Not signed in.', status);

  const body = await request.json().catch(() => ({}));
  const force = Boolean(body.force);

  // If a previous submit request already completed but the browser did not receive
  // the response, treat retry as success so candidates are not left hanging.
  if (session.status === 'completed') return completedResponse(session, true);
  if (session.status !== 'in_progress') return jsonError('Session has already ended. Please check your results page.', 403);

  const questionIds: string[] = Array.isArray(session.question_order) ? session.question_order.map(String) : [];
  const storedAnswers = publicAnswers(session);
  const finalAnswers = {
    ...storedAnswers,
    ...cleanIncomingAnswers(body.answers, questionIds)
  };
  const unanswered = questionIds.filter(id => !finalAnswers[id]);
  const now = new Date();
  const timeUsedSeconds = activeElapsedSeconds(session, now);
  const expired = timeUsedSeconds >= 70 * 60;

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
    const selected = finalAnswers[String(q.id)];
    const isCorrect = String(selected || '') === String(q.correct_option_id);
    if (isCorrect) score += points;
    breakdown[String(q.id)] = { selected, correct: q.correct_option_id, isCorrect, points };
  }

  const submittedAt = now.toISOString();

  const { data: events, error: eventError } = await supabaseAdmin
    .from('proctoring_events')
    .select('event_type,severity')
    .eq('session_id', session.id)
    .limit(1000);

  const proctoringSummary = summarizeProctoring(eventError ? [] : events || []);

  const { data: completed, error: updateError } = await supabaseAdmin
    .from('contest_sessions')
    .update({
      status: 'completed',
      submitted_at: submittedAt,
      time_used_seconds: timeUsedSeconds,
      score,
      max_score: maxScore,
      total_questions: questionIds.length,
      answers: finalAnswers,
      answer_breakdown: breakdown,
      proctoring_summary: proctoringSummary,
      updated_at: submittedAt
    })
    .eq('id', session.id)
    .eq('status', 'in_progress')
    .select('score,max_score,total_questions')
    .maybeSingle();

  if (updateError) return jsonError(updateError.message, 500);

  // If another request finished first, return success instead of leaving the candidate stuck.
  if (!completed) {
    const { data: latest } = await supabaseAdmin
      .from('contest_sessions')
      .select('score,max_score,total_questions,status')
      .eq('id', session.id)
      .maybeSingle();
    if (latest?.status === 'completed') return completedResponse(latest, true);
    return jsonError('Could not complete submission. Please try Submit Test again.', 409);
  }

  await supabaseAdmin.from('participants').update({ is_active: false }).eq('id', session.participant_id).then(() => null);

  const response = NextResponse.json({ success: true, score, maxScore, totalQuestions: questionIds.length });
  clearCookie(response, COOKIE_NAMES.participant);
  return response;
}

function summarizeProctoring(events: Array<{ event_type: string; severity: string }>) {
  const reviewEvents = events.filter(event => !ROUTINE_PROCTORING_EVENTS.has(event.event_type));
  const total = reviewEvents.length;
  const critical = reviewEvents.filter(e => e.severity === 'critical').length;
  const high = reviewEvents.filter(e => e.severity === 'high').length;
  const byType = reviewEvents.reduce<Record<string, number>>((acc, event) => {
    acc[event.event_type] = (acc[event.event_type] || 0) + 1;
    return acc;
  }, {});

  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
  if (critical > 0 || total >= 10) riskLevel = 'CRITICAL';
  else if (high > 0 || total >= 5) riskLevel = 'HIGH';
  else if (total > 0) riskLevel = 'MEDIUM';

  return { total, critical, high, byType, riskLevel };
}
