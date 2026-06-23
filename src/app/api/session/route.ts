import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';
import { getActiveParticipantSession } from '@/lib/sessionGuard';

export async function GET(request: NextRequest) {
  const { session, error, status } = await getActiveParticipantSession(request, '*, participant:participants(id,name,usercode,category,contest_stage)');
  if (error || !session) return jsonError(error || 'Not signed in.', status);

  if (session.status !== 'in_progress') return jsonError('This test session is no longer active.', 403);

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await supabaseAdmin.from('contest_sessions').update({ status: 'expired' }).eq('id', session.id);
    return jsonError('Time is up. Please contact the contest administrator.', 403);
  }

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
      expiresAt: session.expires_at,
      answers: session.answers || {},
      totalQuestions: session.total_questions,
      participant: session.participant
    },
    questions: ordered
  });
}
