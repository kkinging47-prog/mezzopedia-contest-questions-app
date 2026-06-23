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

  const { error } = await supabaseAdmin.from('questions').update(payload).eq('id', id);
  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);
  const { id } = await context.params;
  const { error } = await supabaseAdmin.from('questions').delete().eq('id', id);
  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true });
}
