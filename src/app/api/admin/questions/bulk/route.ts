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

function questionKey(row: Record<string, unknown>) {
  return `${row.category}|${row.phase}|${String(row.question_text || '').trim().toLowerCase()}`;
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

function stripOptionalBulkColumns(row: Record<string, unknown>) {
  const { topic, source_question_no, ...rest } = row;
  return rest;
}

function isMissingOptionalColumnError(error: { message?: string } | null) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('topic') || message.includes('source_question_no') || message.includes('schema cache');
}

async function fetchExistingKeys(rows: Record<string, unknown>[]) {
  const stages = Array.from(new Set(rows.map(row => String(row.phase)).filter(Boolean)));
  const categories = Array.from(new Set(rows.map(row => String(row.category)).filter(Boolean)));
  const existingKeys = new Set<string>();
  if (!stages.length || !categories.length) return { existingKeys, error: null as any };

  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('questions')
      .select('category,phase,question_text')
      .in('phase', stages)
      .in('category', categories)
      .range(from, from + pageSize - 1);

    if (error) return { existingKeys, error };
    for (const row of data || []) existingKeys.add(questionKey(row as Record<string, unknown>));
    if (!data || data.length < pageSize) break;
  }

  return { existingKeys, error: null as any };
}

async function insertRows(rows: Record<string, unknown>[]) {
  const chunkSize = 50;
  let inserted = 0;
  let usedFallbackWithoutOptionalColumns = false;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    let { error } = await supabaseAdmin.from('questions').insert(chunk);

    if (error && isMissingOptionalColumnError(error)) {
      const fallbackRows = chunk.map(stripOptionalBulkColumns);
      const fallback = await supabaseAdmin.from('questions').insert(fallbackRows);
      error = fallback.error;
      usedFallbackWithoutOptionalColumns = !error;
    }

    if (error) return { error, inserted, usedFallbackWithoutOptionalColumns };
    inserted += chunk.length;
  }

  return { error: null, inserted, usedFallbackWithoutOptionalColumns };
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const incoming = Array.isArray(body.questions) ? body.questions : [];
  const batchNumber = Number(body.batchNumber || 1);
  const totalBatches = Number(body.totalBatches || 1);
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

  const seen = new Set<string>();
  const duplicateInBatch: string[] = [];
  const uniqueRows = cleanedRows.filter(row => {
    const key = questionKey(row);
    if (seen.has(key)) {
      duplicateInBatch.push(String(row.source_question_no || row.question_text || key));
      return false;
    }
    seen.add(key);
    return true;
  });

  const { existingKeys, error: existingError } = await fetchExistingKeys(uniqueRows);
  if (existingError) return jsonError(existingError.message, 500);

  const rowsToInsert = uniqueRows.filter(row => !existingKeys.has(questionKey(row)));
  const skippedExisting = uniqueRows.length - rowsToInsert.length;
  const skippedInBatch = duplicateInBatch.length;

  if (!rowsToInsert.length) {
    return Response.json({
      success: true,
      inserted: 0,
      skipped: skippedExisting + skippedInBatch,
      skippedExisting,
      skippedInBatch,
      batchNumber,
      totalBatches,
      message: 'All imported questions in this batch already exist for the selected stage/category.'
    });
  }

  const result = await insertRows(rowsToInsert);
  if (result.error) return jsonError(result.error.message, 500);

  await supabaseAdmin.from('admin_audit_logs').insert({
    action: 'BULK_IMPORT_QUESTIONS',
    entity_type: 'question',
    details: { inserted: result.inserted, skippedExisting, skippedInBatch, batchNumber, totalBatches, usedFallbackWithoutOptionalColumns: result.usedFallbackWithoutOptionalColumns }
  }).then(() => null);

  const note = result.usedFallbackWithoutOptionalColumns
    ? ' The import worked, but topic/source question number were skipped because the optional bulk-upload SQL columns are not yet installed.'
    : '';

  return Response.json({
    success: true,
    inserted: result.inserted,
    skipped: skippedExisting + skippedInBatch,
    skippedExisting,
    skippedInBatch,
    batchNumber,
    totalBatches,
    note
  });
}
