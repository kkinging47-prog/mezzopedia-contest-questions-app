import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';
import { getActiveParticipantSession } from '@/lib/sessionGuard';
import { progressUpdateFor, remainingSessionSeconds } from '@/lib/sessionTime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { session, error, status } = await getActiveParticipantSession(request, 'id,status,answers,question_order,accumulated_time_seconds,active_started_at,current_question_index,active_login_token');
  if (error || !session) return jsonError(error || 'Not signed in.', status);
  if (session.status !== 'in_progress') return jsonError('Session is not active.', 403);

  const body = await request.json().catch(() => ({}));
  const incomingAnswers = body.answers && typeof body.answers === 'object' ? body.answers as Record<string, unknown> : null;
  const currentQuestionIndex = Number(body.currentQuestionIndex);
  const allowedQuestionIds = new Set<string>((session.question_order || []).map(String));
  const answers = { ...(session.answers || {}) } as Record<string, string>;

  if (incomingAnswers) {
    for (const [rawQuestionId, rawOptionId] of Object.entries(incomingAnswers)) {
      const qid = String(rawQuestionId);
      const oid = String(rawOptionId || '');
      if (!allowedQuestionIds.has(qid) || !oid) continue;
      answers[qid] = oid.slice(0, 12);
    }
  }

  const now = new Date();
  const remaining = remainingSessionSeconds(session, now);
  if (remaining <= 0) {
    await supabaseAdmin.from('contest_sessions').update({ status: 'expired', updated_at: now.toISOString() }).eq('id', session.id);
    return jsonError('Time is up.', 403);
  }

  const update = {
    ...progressUpdateFor(session, now, Number.isFinite(currentQuestionIndex) ? currentQuestionIndex : undefined),
    answers
  };

  const { error: updateError } = await supabaseAdmin.from('contest_sessions').update(update).eq('id', session.id);
  if (updateError) return jsonError(`${updateError.message}. Run supabase/run-this-resumable-session-fix.sql in Supabase SQL Editor, then try again.`, 500);

  return Response.json({ success: true, savedAnswers: Object.keys(answers).length, remainingSeconds: Math.max(0, remaining) });
}
