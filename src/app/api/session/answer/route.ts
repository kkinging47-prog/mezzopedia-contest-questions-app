import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';
import { getActiveParticipantSession } from '@/lib/sessionGuard';

export async function POST(request: NextRequest) {
  const { session, error, status } = await getActiveParticipantSession(request, 'id,status,answers,question_order,expires_at,active_login_token');
  if (error || !session) return jsonError(error || 'Not signed in.', status);

  const { questionId, optionId } = await request.json().catch(() => ({}));
  if (!questionId || !optionId) return jsonError('Missing answer.');

  if (session.status !== 'in_progress') return jsonError('Session is not active.', 403);
  if (new Date(session.expires_at).getTime() < Date.now()) return jsonError('Time is up.', 403);
  if (!(session.question_order || []).includes(questionId)) return jsonError('Invalid question for this session.', 403);

  const answers = { ...(session.answers || {}), [questionId]: String(optionId) };
  const { error: updateError } = await supabaseAdmin
    .from('contest_sessions')
    .update({ answers, updated_at: new Date().toISOString() })
    .eq('id', session.id);

  if (updateError) return jsonError(updateError.message, 500);
  return Response.json({ success: true });
}
