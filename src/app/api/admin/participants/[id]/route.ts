import { NextRequest } from 'next/server';
import { requireAdmin, hashPassword } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, normalizeContestStage, safeText } from '@/lib/utils';

function normalizePaymentStatus(value: unknown) {
  const raw = safeText(value || 'unpaid').toLowerCase();
  if (raw === 'paid') return 'paid';
  if (raw === 'pending') return 'pending';
  return 'unpaid';
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

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
  if ('category' in body) payload.category = safeText(body.category);
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
