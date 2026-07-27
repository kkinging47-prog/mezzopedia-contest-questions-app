import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, safeText } from '@/lib/utils';

function normalizeOptions(options: any[]) {
  return options.map((option: any, index: number) => ({
    id: safeText(option.id) || String.fromCharCode(65 + index),
    text: safeText(option.text),
    imageUrl: safeText(option.imageUrl || option.image_url)
  })).filter((option: any) => option.text || option.imageUrl);
}

function validateOptions(cleanOptions: Array<{ id: string; text: string; imageUrl?: string }>, correctOptionId: string) {
  if (cleanOptions.length < 2) return 'At least two answer options are required.';
  if (!cleanOptions.some(option => option.id === correctOptionId)) return 'Correct option must match one of the option IDs.';
  const filledTexts = cleanOptions.map(o => o.text.trim().toLowerCase()).filter(Boolean);
  if (new Set(filledTexts).size !== filledTexts.length) return 'Do not enter the same answer text in more than one option.';
  return '';
}

function cleanPublicAnswers(raw: unknown) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const clean: Record<string, string> = {};
  for (const [questionId, selected] of Object.entries(source)) {
    if (questionId === '__resume') continue;
    const optionId = String(selected || '').trim();
    if (optionId) clean[String(questionId)] = optionId;
  }
  return clean;
}

async function recalculateSubmittedScoresForQuestion(questionId: string) {
  const { data: sessions, error: sessionError } = await supabaseAdmin
    .from('contest_sessions')
    .select('id,question_order,answers,status,submitted_at')
    .in('status', ['completed', 'expired'])
    .not('submitted_at', 'is', null)
    .contains('question_order', [questionId]);

  if (sessionError) return { affectedSessions: 0, updatedSessions: 0, error: sessionError.message };
  const rows = (sessions || []) as any[];
  if (!rows.length) return { affectedSessions: 0, updatedSessions: 0, error: '' };

  const allQuestionIds = Array.from(new Set(rows.flatMap(row => Array.isArray(row.question_order) ? row.question_order.map(String) : []))).filter(Boolean);
  if (!allQuestionIds.length) return { affectedSessions: rows.length, updatedSessions: 0, error: '' };

  const { data: questions, error: questionError } = await supabaseAdmin
    .from('questions')
    .select('id,correct_option_id,points')
    .in('id', allQuestionIds);
  if (questionError) return { affectedSessions: rows.length, updatedSessions: 0, error: questionError.message };

  const questionMap = new Map((questions || []).map((question: any) => [String(question.id), question]));
  const now = new Date().toISOString();
  let updatedSessions = 0;

  for (const session of rows) {
    const questionIds = Array.isArray(session.question_order) ? session.question_order.map(String).filter(Boolean) : [];
    const answers = cleanPublicAnswers(session.answers);
    let score = 0;
    let maxScore = 0;
    const breakdown: Record<string, { selected?: string; correct: string; isCorrect: boolean; points: number }> = {};

    for (const id of questionIds) {
      const question = questionMap.get(id);
      if (!question) continue;
      const points = Number(question.points || 1);
      const selected = answers[id];
      const correct = String(question.correct_option_id || '');
      const isCorrect = String(selected || '') === correct;
      maxScore += points;
      if (isCorrect) score += points;
      breakdown[id] = { selected, correct, isCorrect, points };
    }

    const { error: updateError } = await supabaseAdmin
      .from('contest_sessions')
      .update({
        score,
        max_score: maxScore,
        total_questions: questionIds.length,
        answers,
        answer_breakdown: breakdown,
        updated_at: now
      })
      .eq('id', session.id);

    if (!updateError) updatedSessions += 1;
  }

  return { affectedSessions: rows.length, updatedSessions, error: '' };
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  const payload: Record<string, any> = {};
  if ('category' in body) payload.category = safeText(body.category);
  if ('questionText' in body || 'question_text' in body) payload.question_text = safeText(body.questionText || body.question_text);
  if ('questionImageUrl' in body || 'question_image_url' in body) payload.question_image_url = safeText(body.questionImageUrl || body.question_image_url);
  if ('options' in body) {
    const cleanOptions = normalizeOptions(Array.isArray(body.options) ? body.options : []);
    const correctOptionId = safeText(body.correctOptionId || body.correct_option_id);
    const optionError = validateOptions(cleanOptions, correctOptionId);
    if (optionError) return jsonError(optionError);
    payload.options = cleanOptions;
  }
  if ('correctOptionId' in body || 'correct_option_id' in body) payload.correct_option_id = safeText(body.correctOptionId || body.correct_option_id);
  if ('explanation' in body) payload.explanation = safeText(body.explanation);
  if ('points' in body) payload.points = Number(body.points || 1);
  if ('phase' in body) payload.phase = safeText(body.phase);
  if ('isActive' in body || 'is_active' in body) payload.is_active = body.isActive ?? body.is_active;
  payload.updated_at = new Date().toISOString();

  const scoreAffectingChange = 'correctOptionId' in body || 'correct_option_id' in body || 'points' in body;

  const { error } = await supabaseAdmin.from('questions').update(payload).eq('id', id);
  if (error) return jsonError(error.message, 500);

  const recalculation = scoreAffectingChange
    ? await recalculateSubmittedScoresForQuestion(id)
    : { affectedSessions: 0, updatedSessions: 0, error: '' };

  if (scoreAffectingChange) {
    await supabaseAdmin.from('admin_audit_logs').insert({
      action: 'QUESTION_SCORE_RECALCULATION',
      entity_type: 'question',
      entity_id: id,
      details: {
        questionId: id,
        affectedSessions: recalculation.affectedSessions,
        updatedSessions: recalculation.updatedSessions,
        recalculationError: recalculation.error || '',
        note: 'Question answer key/points were edited; submitted scores containing this question were recalculated.'
      }
    }).then(() => null);
  }

  return Response.json({
    success: true,
    scoreRecalculated: scoreAffectingChange,
    affectedSessions: recalculation.affectedSessions,
    recalculatedSessions: recalculation.updatedSessions,
    recalculationWarning: recalculation.error || ''
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);
  const { id } = await context.params;
  const { error } = await supabaseAdmin.from('questions').delete().eq('id', id);
  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true });
}
