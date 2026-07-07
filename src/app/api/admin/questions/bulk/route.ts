import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, normalizeContestStage, safeText } from '@/lib/utils';
import { DEFAULT_CATEGORIES } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type BulkOption = { id: string; text: string; imageUrl?: string };
type CleanRowResult = { error: string; row?: never } | { row: Record<string, unknown>; error?: never };
type BulkQuestionInput = {
  questionNo?: unknown;
  source_question_no?: unknown;
  category?: unknown;
  stage?: unknown;
  phase?: unknown;
  topic?: unknown;
  questionText?: unknown;
  question_text?: unknown;
  questionImageUrl?: unknown;
  question_image_url?: unknown;
  optionA?: unknown;
  option_a?: unknown;
  optionAImageUrl?: unknown;
  option_a_image_url?: unknown;
  optionB?: unknown;
  option_b?: unknown;
  optionBImageUrl?: unknown;
  option_b_image_url?: unknown;
  optionC?: unknown;
  option_c?: unknown;
  optionCImageUrl?: unknown;
  option_c_image_url?: unknown;
  optionD?: unknown;
  option_d?: unknown;
  optionDImageUrl?: unknown;
  option_d_image_url?: unknown;
  correctOptionId?: unknown;
  correct_option_id?: unknown;
  explanation?: unknown;
  points?: unknown;
  isActive?: unknown;
  is_active?: unknown;
};

function normalizeCategory(value: unknown) {
  const raw = safeText(value);
  return DEFAULT_CATEGORIES.find(category => category.toLowerCase() === raw.toLowerCase()) || raw;
}

function booleanValue(value: unknown) {
  if (typeof value === 'boolean') return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return true;
  return !['false', 'no', '0', 'inactive'].includes(raw);
}

function option(id: string, text: unknown, imageUrl: unknown): BulkOption | null {
  const cleanText = safeText(text);
  const cleanImage = safeText(imageUrl);
  if (!cleanText && !cleanImage) return null;
  return { id, text: cleanText, ...(cleanImage ? { imageUrl: cleanImage } : {}) };
}

function cleanRow(row: BulkQuestionInput): CleanRowResult {
  const category = normalizeCategory(row.category);
  const phase = normalizeContestStage(row.stage || row.phase || 'Stage 1');
  const questionText = safeText(row.questionText || row.question_text);
  const correct = safeText(row.correctOptionId || row.correct_option_id).toUpperCase();
  const questionNo = safeText(row.questionNo || row.source_question_no);

  const options = [
    option('A', row.optionA || row.option_a, row.optionAImageUrl || row.option_a_image_url),
    option('B', row.optionB || row.option_b, row.optionBImageUrl || row.option_b_image_url),
    option('C', row.optionC || row.option_c, row.optionCImageUrl || row.option_c_image_url),
    option('D', row.optionD || row.option_d, row.optionDImageUrl || row.option_d_image_url)
  ].filter(Boolean) as BulkOption[];

  if (!category || !phase || !questionText || !correct) return { error: `Question ${questionNo || ''}: category, stage, question text and correct option are required.` };
  if (!DEFAULT_CATEGORIES.includes(category)) return { error: `Question ${questionNo || ''}: invalid category "${category}".` };
  if (!['A', 'B', 'C', 'D'].includes(correct)) return { error: `Question ${questionNo || ''}: correct option must be A, B, C or D.` };
  if (options.length < 2) return { error: `Question ${questionNo || ''}: at least two options are required.` };
  if (!options.some(item => item.id === correct)) return { error: `Question ${questionNo || ''}: correct option does not match an available option.` };

  const texts = options.map(item => item.text.trim().toLowerCase()).filter(Boolean);
  if (new Set(texts).size !== texts.length) return { error: `Question ${questionNo || ''}: duplicate answer option text found.` };

  return {
    row: {
      category,
      phase,
      topic: safeText(row.topic),
      source_question_no: questionNo,
      question_text: questionText,
      question_image_url: safeText(row.questionImageUrl || row.question_image_url),
      options,
      correct_option_id: correct,
      explanation: safeText(row.explanation),
      points: Math.max(1, Number(row.points || 1) || 1),
      is_active: booleanValue(row.isActive ?? row.is_active)
    }
  };
}

async function insertInChunks(rows: Record<string, unknown>[]) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await supabaseAdmin.from('questions').insert(chunk);
    if (error) return { error, inserted };
    inserted += chunk.length;
  }
  return { error: null, inserted };
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const incoming = Array.isArray(body.questions) ? body.questions : [];
  if (!incoming.length) return jsonError('No questions found to import.');

  const cleanedRows: Record<string, unknown>[] = [];
  const errors: string[] = [];
  for (const item of incoming) {
    const cleaned = cleanRow(item as BulkQuestionInput);
    if (cleaned.error) {
      errors.push(cleaned.error);
    } else if (cleaned.row) {
      cleanedRows.push(cleaned.row);
    }
  }

  if (errors.length) return jsonError(errors.slice(0, 20).join(' | '), 400);
  if (!cleanedRows.length) return jsonError('No valid questions found.');

  const stages = Array.from(new Set(cleanedRows.map(row => String(row.phase))));
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('questions')
    .select('category,phase,question_text')
    .in('phase', stages);
  if (existingError) return jsonError(existingError.message, 500);

  const existingKeys = new Set((existing || []).map((row: any) => `${row.category}|${row.phase}|${String(row.question_text || '').trim().toLowerCase()}`));
  const rowsToInsert = cleanedRows.filter(row => !existingKeys.has(`${row.category}|${row.phase}|${String(row.question_text).trim().toLowerCase()}`));
  const skipped = cleanedRows.length - rowsToInsert.length;

  if (!rowsToInsert.length) return Response.json({ success: true, inserted: 0, skipped, message: 'All imported questions already exist for the selected stage/category.' });

  const result = await insertInChunks(rowsToInsert);
  if (result.error) {
    const message = result.error.message.includes('topic') || result.error.message.includes('source_question_no')
      ? `${result.error.message}. Run supabase/run-this-bulk-question-upload-fix.sql in Supabase SQL Editor, then try again.`
      : result.error.message;
    return jsonError(message, 500);
  }

  await supabaseAdmin.from('admin_audit_logs').insert({ action: 'BULK_IMPORT_QUESTIONS', entity_type: 'question', details: { inserted: result.inserted, skipped } }).then(() => null);
  return Response.json({ success: true, inserted: result.inserted, skipped });
}
