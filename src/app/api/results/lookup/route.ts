import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyPassword } from '@/lib/auth';
import { jsonError, normalizeCategory, percentage } from '@/lib/utils';
import { activeElapsedSeconds, publicAnswers } from '@/lib/sessionTime';

function optionText(options: any[], optionId: string) {
  const match = (options || []).find(option => String(option.id) === String(optionId));
  if (!match) return '';
  return match.text || match.imageUrl || '';
}

function submittedTime(value?: string) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function sessionTimeUsed(session: any) {
  return activeElapsedSeconds(session, session?.submitted_at ? new Date(session.submitted_at) : new Date());
}

function bestResultSession(a: any, b: any) {
  const aSubmitted = submittedTime(a?.submitted_at) > 0;
  const bSubmitted = submittedTime(b?.submitted_at) > 0;
  if (aSubmitted !== bSubmitted) return aSubmitted ? -1 : 1;

  // Retake setup archives the old attempt as expired. Once the candidate writes
  // again, show the new completed result instead of the older archived result.
  const aCompleted = a?.status === 'completed';
  const bCompleted = b?.status === 'completed';
  if (aCompleted !== bCompleted) return aCompleted ? -1 : 1;

  const scoreDiff = Number(b?.score || 0) - Number(a?.score || 0);
  if (scoreDiff) return scoreDiff;

  const timeDiff = sessionTimeUsed(a) - sessionTimeUsed(b);
  if (timeDiff) return timeDiff;

  return submittedTime(b?.submitted_at) - submittedTime(a?.submitted_at);
}

export async function POST(request: Request) {
  const { category, usercode, password } = await request.json().catch(() => ({}));
  const code = String(usercode || '').trim();
  const cat = normalizeCategory(String(category || ''));
  const pass = String(password || '');

  if (!cat || !code || !pass) return jsonError('Enter your category, usercode and password.');

  const { data: participant, error } = await supabaseAdmin
    .from('participants')
    .select('*')
    .eq('category', cat)
    .ilike('usercode', code)
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  if (!participant) return jsonError('Invalid result lookup details.', 401);

  const ok = await verifyPassword(pass, participant.password_hash);
  if (!ok) return jsonError('Invalid result lookup details.', 401);

  const { data: sessions, error: sError } = await supabaseAdmin
    .from('contest_sessions')
    .select('*')
    .eq('participant_id', participant.id)
    .in('status', ['completed', 'expired'])
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false })
    .limit(25);

  if (sError) return jsonError(sError.message, 500);
  if (!sessions?.length) return jsonError('No completed result found for this code.', 404);

  // Completed sessions are the normal source. Promoted or retake-replaced results
  // are archived as "expired", so they are still allowed for history when there
  // is no newer completed result for the same candidate.
  const session = [...sessions].sort(bestResultSession)[0];
  const timeUsedSeconds = sessionTimeUsed(session);

  const questionIds: string[] = Array.isArray(session.question_order) ? session.question_order.map(String) : [];
  const answers = publicAnswers(session);
  const breakdown = session.answer_breakdown || {};

  let script: any[] = [];
  if (questionIds.length) {
    const { data: questions, error: qError } = await supabaseAdmin
      .from('questions')
      .select('id,category,phase,question_text,question_image_url,options,correct_option_id,points,explanation')
      .in('id', questionIds);
    if (qError) return jsonError(qError.message, 500);

    const byId = new Map((questions || []).map((q: any) => [String(q.id), q]));
    script = questionIds.map((id, index) => {
      const q: any = byId.get(id);
      if (!q) return null;
      const selectedOptionId = String(answers[id] || breakdown[id]?.selected || '');
      const correctOptionId = String(q.correct_option_id || breakdown[id]?.correct || '');
      const isCorrect = selectedOptionId && selectedOptionId === correctOptionId;
      const points = Number(q.points || breakdown[id]?.points || 1);
      return {
        number: index + 1,
        questionId: id,
        category: q.category,
        stage: q.phase || session.contest_stage || '',
        questionText: q.question_text,
        questionImageUrl: q.question_image_url || '',
        options: q.options || [],
        selectedOptionId,
        selectedAnswer: optionText(q.options || [], selectedOptionId),
        correctOptionId,
        correctAnswer: optionText(q.options || [], correctOptionId),
        isCorrect,
        points,
        pointsAwarded: isCorrect ? points : 0,
        explanation: q.explanation || ''
      };
    }).filter(Boolean);
  }

  return Response.json({
    success: true,
    result: {
      participant: { name: participant.name, usercode: participant.usercode, category: participant.category, paymentStatus: participant.payment_status },
      stage: session.contest_stage || '',
      status: session.status,
      score: session.score || 0,
      maxScore: session.max_score || session.total_questions || 0,
      totalQuestions: session.total_questions || 0,
      percentage: percentage(session.score || 0, session.max_score || session.total_questions || 0),
      timeUsedSeconds,
      submittedAt: session.submitted_at,
      proctoringSummary: session.proctoring_summary || {},
      script
    }
  });
}