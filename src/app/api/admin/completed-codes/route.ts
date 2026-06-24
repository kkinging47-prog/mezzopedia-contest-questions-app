import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, percentage } from '@/lib/utils';

type CompletedRow = {
  id: string;
  participant_id: string;
  category: string;
  status: string;
  started_at: string;
  submitted_at: string | null;
  time_used_seconds: number | null;
  score: number | null;
  max_score: number | null;
  total_questions: number | null;
  participant?: {
    id: string;
    name: string;
    usercode: string;
    category: string;
    payment_status: string;
    contest_stage: string;
    is_active: boolean;
    login_count: number;
    last_login_at: string | null;
  } | null;
};

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const category = request.nextUrl.searchParams.get('category');
  const stage = request.nextUrl.searchParams.get('stage');

  let query = supabaseAdmin
    .from('contest_sessions')
    .select('id,participant_id,category,status,started_at,submitted_at,time_used_seconds,score,max_score,total_questions, participant:participants(id,name,usercode,category,payment_status,contest_stage,is_active,login_count,last_login_at)')
    .eq('status', 'completed')
    .order('submitted_at', { ascending: false, nullsFirst: false });

  if (category && category !== 'All') query = query.eq('category', category);

  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);

  const completedCodes = ((data || []) as unknown as CompletedRow[])
    .filter(row => !stage || stage === 'All' || row.participant?.contest_stage === stage)
    .map(row => ({
      sessionId: row.id,
      participantId: row.participant_id,
      name: row.participant?.name || '',
      usercode: row.participant?.usercode || '',
      category: row.category || row.participant?.category || '',
      contestStage: row.participant?.contest_stage || 'Stage 1',
      paymentStatus: row.participant?.payment_status || '',
      access: row.participant?.is_active ? 'Open' : 'Closed',
      loginCount: row.participant?.login_count || 0,
      lastLoginAt: row.participant?.last_login_at || null,
      score: row.score || 0,
      maxScore: row.max_score || row.total_questions || 0,
      percentage: percentage(row.score || 0, row.max_score || row.total_questions || 0),
      timeUsedSeconds: row.time_used_seconds || 0,
      startedAt: row.started_at,
      submittedAt: row.submitted_at
    }));

  return Response.json({ success: true, completedCodes });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const resetAll = Boolean(body.resetAll);
  let participantIds: string[] = Array.isArray(body.participantIds)
    ? body.participantIds.map((id: unknown) => String(id)).filter(Boolean)
    : [];

  if (resetAll) {
    const category = body.category && body.category !== 'All' ? String(body.category) : '';
    const stage = body.stage && body.stage !== 'All' ? String(body.stage) : '';

    let query = supabaseAdmin
      .from('contest_sessions')
      .select('participant_id, category, participant:participants(contest_stage)')
      .eq('status', 'completed');

    if (category) query = query.eq('category', category);

    const { data, error } = await query;
    if (error) return jsonError(error.message, 500);

    participantIds = Array.from(new Set(((data || []) as any[])
      .filter(row => !stage || row.participant?.contest_stage === stage)
      .map(row => row.participant_id)
      .filter(Boolean)));
  }

  if (!participantIds.length) return jsonError('Select at least one completed code to reset.', 400);

  const now = new Date().toISOString();

  const { error: sessionError } = await supabaseAdmin
    .from('contest_sessions')
    .update({
      status: 'cancelled',
      active_login_token: null,
      active_user_agent: null,
      last_reauth_at: null,
      updated_at: now
    })
    .in('participant_id', participantIds)
    .in('status', ['completed', 'expired', 'in_progress']);

  if (sessionError) return jsonError(sessionError.message, 500);

  const { error: participantError } = await supabaseAdmin
    .from('participants')
    .update({
      is_active: true,
      login_count: 0,
      last_login_at: null,
      updated_at: now
    })
    .in('id', participantIds);

  if (participantError) return jsonError(participantError.message, 500);

  await supabaseAdmin.from('admin_audit_logs').insert({
    action: resetAll ? 'RESET_ALL_COMPLETED_CODES' : 'RESET_SELECTED_COMPLETED_CODES',
    entity_type: 'participant',
    details: { participantIds, count: participantIds.length, note: 'Completed/expired/in-progress sessions were marked cancelled so these codes can retake the test.' }
  }).then(() => null);

  return Response.json({ success: true, resetCount: participantIds.length });
}
