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

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const category = request.nextUrl.searchParams.get('category');
  const phase = request.nextUrl.searchParams.get('phase') || request.nextUrl.searchParams.get('stage');
  let query = supabaseAdmin.from('questions').select('*').order('created_at', { ascending: false });
  if (category && category !== 'All') query = query.eq('category', category);
  if (phase && phase !== 'All') query = query.eq('phase', phase);
  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true, questions: data || [] });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const category = safeText(body.category);
  const questionText = safeText(body.questionText || body.question_text);
  const options = Array.isArray(body.options) ? body.options : [];
  const correctOptionId = safeText(body.correctOptionId || body.correct_option_id);
  const cleanOptions = normalizeOptions(options);

  if (!category || !questionText || !correctOptionId) {
    return jsonError('Category, question and the correct answer are required.');
  }

  const optionError = validateOptions(cleanOptions, correctOptionId);
  if (optionError) return jsonError(optionError);

  const { data, error } = await supabaseAdmin
    .from('questions')
    .insert({
      category,
      question_text: questionText,
      question_image_url: safeText(body.questionImageUrl || body.question_image_url),
      options: cleanOptions,
      correct_option_id: correctOptionId,
      explanation: safeText(body.explanation),
      points: Number(body.points || 1),
      phase: safeText(body.phase || 'Stage 1'),
      is_active: body.isActive ?? body.is_active ?? true
    })
    .select('*')
    .single();

  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true, question: data });
}
