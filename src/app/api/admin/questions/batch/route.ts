import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, safeText } from '@/lib/utils';

function applyQuestionFilters(query: any, category: string, phase: string) {
  let next = query;
  if (category && category !== 'All') next = next.eq('category', category);
  if (phase && phase !== 'All') next = next.eq('phase', phase);
  return next;
}

function chunk<T>(items: T[], size = 500) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function cleanIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => safeText(item)).filter(Boolean)));
}

async function findMatchingQuestionIds(category: string, phase: string) {
  const query = applyQuestionFilters(
    supabaseAdmin.from('questions').select('id'),
    category,
    phase
  );
  const { data, error } = await query;
  if (error) return { ids: [] as string[], error };
  return { ids: (data || []).map((row: any) => row.id).filter(Boolean), error: null };
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const action = safeText(body.action);
  const category = safeText(body.category || 'All') || 'All';
  const phase = safeText(body.phase || body.stage || 'All') || 'All';
  const targetPhase = safeText(body.targetPhase || body.targetStage);

  let ids = cleanIds(body.ids || body.questionIds);
  if (!ids.length) {
    const found = await findMatchingQuestionIds(category, phase);
    if (found.error) return jsonError(found.error.message, 500);
    ids = found.ids;
  }

  if (!ids.length) return jsonError('No questions matched the selected filter/search.', 404);

  if (action === 'deleteFiltered' || action === 'deleteIds') {
    for (const idsChunk of chunk(ids)) {
      const { error } = await supabaseAdmin.from('questions').delete().in('id', idsChunk);
      if (error) return jsonError(error.message, 500);
    }
    await supabaseAdmin.from('admin_audit_logs').insert({
      action: action === 'deleteIds' ? 'BATCH_DELETE_SEARCHED_QUESTIONS' : 'BATCH_DELETE_QUESTIONS',
      entity_type: 'question',
      details: { category, phase, count: ids.length, usedExplicitIds: action === 'deleteIds' }
    }).then(() => null);
    return Response.json({ success: true, deletedCount: ids.length });
  }

  if (action === 'moveFiltered' || action === 'moveIds') {
    if (!targetPhase || targetPhase === 'All') return jsonError('Select the stage to move the questions into.', 400);
    const now = new Date().toISOString();
    for (const idsChunk of chunk(ids)) {
      const { error } = await supabaseAdmin.from('questions').update({ phase: targetPhase, updated_at: now }).in('id', idsChunk);
      if (error) return jsonError(error.message, 500);
    }
    await supabaseAdmin.from('admin_audit_logs').insert({
      action: action === 'moveIds' ? 'BATCH_MOVE_SEARCHED_QUESTIONS' : 'BATCH_MOVE_QUESTIONS',
      entity_type: 'question',
      details: { category, fromPhase: phase, targetPhase, count: ids.length, usedExplicitIds: action === 'moveIds' }
    }).then(() => null);
    return Response.json({ success: true, movedCount: ids.length, targetPhase });
  }

  return jsonError('Unknown question batch action.', 400);
}
