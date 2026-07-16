import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';
import { getActiveParticipantSession } from '@/lib/sessionGuard';
import { progressUpdateFor, remainingSessionSeconds } from '@/lib/sessionTime';

export async function POST(request: NextRequest) {
  const { session, error, status } = await getActiveParticipantSession(request, 'id,status,answers,question_order,expires_at,accumulated_time_seconds,active_started_at,current_question_index,active_login_token');
  if (error || !session) return jsonError(error || 'Not signed in.', status);

  const body = await request.json().catch(() => ({}));
  const questionId = body.questionId;
  const optionId = body.optionId;
  const incomingAnswers = body.answers && typeof body.answers === 'object' ? body.answers as Record<string, unknown> : null;
  const currentQuestionIndex = Number(body.currentQuestionIndex);

  if (!questionId && !incomingAnswers) return jsonError('Missing answer.');
  if (session.status !== 'in_progress') return jsonError('Session is not active.', 403);

  const now = new Date();
  if (remainingSessionSeconds(session, now) <= 0) {
    await supabaseAdmin.from('contest_sessions').update({ status: 'expired', updated_at: now.toISOString() }).eq('id', session.id);
    return jsonError('Time is up.', 403);
  }

  const allowedQuestionIds = new Set<string>((session.question_order || []).map(String));
  const answers = { ...(session.answers || {}) } as Record<string, string>;

  if (incomingAnswers) {
    for (const [rawQuestionId, rawOptionId] of Object.entries(incomingAnswers)) {
      const qid = String(rawQuestionId);
      const oid = String(rawOptionId || '');
      if (!allowedQuestionIds.has(qid) || !oid) continue;
      answers[qid] = oid.slice(0, 12);
    }
  } else {
    const qid = String(questionId);
    if (!allowedQuestionIds.has(qid)) return jsonError('Invalid question for this session.', 403);
    if (!optionId) return jsonError('Missing answer.');
    answers[qid] = String(optionId).slice(0, 12);
  }

  const update = {
    ...progressUpdateFor(session, now, Number.isFinite(currentQuestionIndex) ? currentQuestionIndex : undefined),
    answers
  };

  const { error: updateError } = await supabaseAdmin
    .from('contest_sessions')
    .update(update)
    .eq('id', session.id);

  if (updateError) return jsonError(`${updateError.message}. Run supabase/run-this-resumable-session-fix.sql in Supabase SQL Editor, then try again.`, 500);
  return Response.json({ success: true, saved: Object.keys(answers).length });
}
