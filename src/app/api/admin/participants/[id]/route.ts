import { NextRequest } from 'next/server';
import { requireAdmin, hashPassword } from '@/lib/auth';
import { DEFAULT_CATEGORIES } from '@/lib/constants';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, normalizeContestStage, safeText } from '@/lib/utils';

function normalizePaymentStatus(value: unknown) {
  const raw = safeText(value || 'unpaid').toLowerCase();
  if (raw === 'paid') return 'paid';
  if (raw === 'pending') return 'pending';
  return 'unpaid';
}

function normalizeCategory(value: unknown) {
  const raw = safeText(value);
  if (!raw) return '';
  const exact = DEFAULT_CATEGORIES.find(category => category.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  if (raw.toLowerCase() === 'adult' || raw.toLowerCase() === 'adults') return 'Adults';
  return '';
}

async function allowRetake(id: string, stageInput: unknown) {
  const stage = normalizeContestStage(stageInput || 'Stage 1');
  const now = new Date().toISOString();

  const { data: participant, error: participantError } = await supabaseAdmin
    .from('participants')
    .select('id,name,usercode,category,contest_stage')
    .eq('id', id)
    .maybeSingle();
  if (participantError) return { error: participantError.message, status: 500 };
  if (!participant) return { error: 'Participant not found.', status: 404 };

  const { data: sessions, error: sessionReadError } = await supabaseAdmin
    .from('contest_sessions')
    .select('id,status,submitted_at,score,total_questions')
    .eq('participant_id', id)
    .eq('contest_stage', stage)
    .in('status', ['completed', 'in_progress']);
  if (sessionReadError) return { error: sessionReadError.message, status: 500 };

  const sessionIds = (sessions || []).map(session => session.id);
  if (sessionIds.length) {
    const { error: sessionUpdateError } = await supabaseAdmin
      .from('contest_sessions')
      .update({ status: 'expired', updated_at: now })
      .in('id', sessionIds);
    if (sessionUpdateError) return { error: sessionUpdateError.message, status: 500 };
  }

  const { error: updateParticipantError } = await supabaseAdmin
    .from('participants')
    .update({ contest_stage: stage, is_active: true, login_count: 0, last_login_at: null, updated_at: now })
    .eq('id', id);
  if (updateParticipantError) return { error: updateParticipantError.message, status: 500 };

  await supabaseAdmin.from('admin_audit_logs').insert({
    action: 'ALLOW_STAGE_RETAKE',
    entity_type: 'participant',
    entity_id: id,
    details: {
      participant: { name: participant.name, usercode: participant.usercode, category: participant.category },
      stage,
      archivedSessionCount: sessionIds.length,
      archivedSessionIds: sessionIds
    }
  }).then(() => null);

  return { stage, archivedSessionCount: sessionIds.length };
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  if (body.retakeStage || body.allowRetake) {
    const result = await allowRetake(id, body.retakeStage || body.contestStage || body.contest_stage || 'Stage 1');
    if ('error' in result) return jsonError(result.error, result.status);
    return Response.json({ success: true, retake: true, ...result });
  }

  const newUsercode = safeText(body.usercode);
  if (newUsercode) {
    const { data: duplicates, error: duplicateError } = await supabaseAdmin
      .from('participants')
      .select('id,name,usercode,category')
      .ilike('usercode', newUsercode)
      .neq('id', id)
      .limit(5);
    if (duplicateError) return jsonError(duplicateError.message, 500);
    if (duplicates?.length) {
      return Response.json({
        success: false,
        duplicate: true,
        error: 'Another participant already has this usercode. Use a unique code before saving.',
        duplicates
      }, { status: 409 });
    }
  }

  const payload: Record<string, any> = { updated_at: new Date().toISOString() };
  if ('category' in body) {
    const category = normalizeCategory(body.category);
    if (!category) return jsonError(`Choose a valid contest category: ${DEFAULT_CATEGORIES.join(', ')}. Do not use the broad category student.`, 400);
    payload.category = category;
  }
  if ('name' in body) payload.name = safeText(body.name);
  if ('usercode' in body) payload.usercode = newUsercode;
  if ('paymentStatus' in body || 'payment_status' in body) payload.payment_status = normalizePaymentStatus(body.paymentStatus || body.payment_status);
  if ('contestStage' in body || 'contest_stage' in body) payload.contest_stage = normalizeContestStage(body.contestStage || body.contest_stage || 'Stage 1');
  if ('isActive' in body || 'is_active' in body) payload.is_active = body.isActive ?? body.is_active;
  if (safeText(body.password)) payload.password_hash = await hashPassword(safeText(body.password));

  const { error } = await supabaseAdmin.from('participants').update(payload).eq('id', id);
  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);
  const { id } = await context.params;
  const { error } = await supabaseAdmin.from('participants').delete().eq('id', id);
  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true });
}