import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';
import { getActiveParticipantSession } from '@/lib/sessionGuard';

export async function POST(request: NextRequest) {
  const { session, error, status } = await getActiveParticipantSession(request, 'id,status,answers,question_order,expires_at,active_login_token');
  if (error || !session) return jsonError(error || 'Not signed in.', status);

  const body = await request.json().catch(() => ({}));
  const questionId = body.questionId;
  const optionId = body.optionId;
  const incomingAnswers = body.answers && typeof body.answers === 'object' ? body.answers as Record<string, unknown> : null;

  if (!questionId && !incomingAnswers) return jsonError('Missing answer.');
  if (session.status !== 'in_progress') return jsonError('Session is not active.', 403);
  if (new Date(session.expires_at).getTime() < Date.now()) return jsonError('Time is up.', 403);

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

  const { error: updateError } = await supabaseAdmin
    .from('contest_sessions')
    .update({ answers, updated_at: new Date().toISOString() })
    .eq('id', session.id);

  if (updateError) return jsonError(updateError.message, 500);
  return Response.json({ success: true, saved: Object.keys(answers).length });
}
