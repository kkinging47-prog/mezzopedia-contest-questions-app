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

  const { ids, error: idError } = await findMatchingQuestionIds(category, phase);
  if (idError) return jsonError(idError.message, 500);
  if (!ids.length) return jsonError('No questions matched the selected category/stage filter.', 404);

  if (action === 'deleteFiltered') {
    for (const idsChunk of chunk(ids)) {
      const { error } = await supabaseAdmin.from('questions').delete().in('id', idsChunk);
      if (error) return jsonError(error.message, 500);
    }
    await supabaseAdmin.from('admin_audit_logs').insert({
      action: 'BATCH_DELETE_QUESTIONS',
      entity_type: 'question',
      details: { category, phase, count: ids.length }
    }).then(() => null);
    return Response.json({ success: true, deletedCount: ids.length });
  }

  if (action === 'moveFiltered') {
    if (!targetPhase || targetPhase === 'All') return jsonError('Select the stage to move the questions into.', 400);
    for (const idsChunk of chunk(ids)) {
      const { error } = await supabaseAdmin.from('questions').update({ phase: targetPhase, updated_at: new Date().toISOString() }).in('id', idsChunk);
      if (error) return jsonError(error.message, 500);
    }
    await supabaseAdmin.from('admin_audit_logs').insert({
      action: 'BATCH_MOVE_QUESTIONS',
      entity_type: 'question',
      details: { category, fromPhase: phase, targetPhase, count: ids.length }
    }).then(() => null);
    return Response.json({ success: true, movedCount: ids.length, targetPhase });
  }

  return jsonError('Unknown question batch action.', 400);
}
