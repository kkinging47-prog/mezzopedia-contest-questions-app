import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';
import { getActiveParticipantSession } from '@/lib/sessionGuard';
import { activeElapsedSeconds, answersWithResumeMeta, currentQuestionIndexFrom, dynamicExpiresAt, publicAnswers, remainingSessionSeconds, TEST_DURATION_SECONDS } from '@/lib/sessionTime';

const SESSION_FIELDS = 'id,status,started_at,expires_at,answers,total_questions,question_order,participant_id,active_login_token,participant:participants(id,name,usercode,category,contest_stage)';

export async function GET(request: NextRequest) {
  const { session, error, status } = await getActiveParticipantSession(request, SESSION_FIELDS);
  if (error || !session) return jsonError(error || 'Not signed in.', status);

  if (session.status !== 'in_progress') return jsonError('This test session is no longer active.', 403);

  const now = new Date();
  const remainingSeconds = remainingSessionSeconds(session, now);
  if (remainingSeconds <= 0) {
    await supabaseAdmin.from('contest_sessions').update({ status: 'expired', updated_at: now.toISOString() }).eq('id', session.id);
    return jsonError('Time is up. Please contact the contest administrator.', 403);
  }

  const refreshedAnswers = answersWithResumeMeta(session, now, undefined, currentQuestionIndexFrom(session));
  await supabaseAdmin.from('contest_sessions').update({ answers: refreshedAnswers, updated_at: now.toISOString() }).eq('id', session.id).then(() => null);
  const refreshedSession = { ...session, answers: refreshedAnswers };

  const questionIds = session.question_order || [];
  const { data: questions, error: qError } = await supabaseAdmin
    .from('questions')
    .select('id, category, question_text, question_image_url, options, points')
    .in('id', questionIds);

  if (qError) return jsonError(qError.message, 500);
  const byId = new Map((questions || []).map(q => [q.id, q]));
  const ordered = questionIds.map((id: string) => byId.get(id)).filter(Boolean).map((q: any) => ({
    id: q.id,
    category: q.category,
    text: q.question_text,
    imageUrl: q.question_image_url,
    options: q.options,
    points: q.points
  }));

  return Response.json({
    success: true,
    session: {
      id: session.id,
      startedAt: session.started_at,
      expiresAt: dynamicExpiresAt(refreshedSession, now),
      answers: publicAnswers(refreshedSession),
      totalQuestions: session.total_questions,
      participant: session.participant,
      currentQuestionIndex: currentQuestionIndexFrom(refreshedSession),
      timeUsedSeconds: activeElapsedSeconds(refreshedSession, now),
      durationSeconds: TEST_DURATION_SECONDS
    },
    questions: ordered
  });
}
