import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyPassword } from '@/lib/auth';
import { jsonError, normalizeCategory, percentage } from '@/lib/utils';

export async function POST(request: Request) {
  const { category, usercode, password } = await request.json().catch(() => ({}));
  const code = String(usercode || '').trim();
  const cat = normalizeCategory(String(category || ''));
  const pass = String(password || '');

  if (!cat || !code || !pass) return jsonError('Enter your category, usercode and password.');

  const { data: participant, error } = await supabaseAdmin
    .from('participants')
    .select('*')
    .eq('category', cat)
    .ilike('usercode', code)
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  if (!participant) return jsonError('Invalid result lookup details.', 401);

  const ok = await verifyPassword(pass, participant.password_hash);
  if (!ok) return jsonError('Invalid result lookup details.', 401);

  const { data: session, error: sError } = await supabaseAdmin
    .from('contest_sessions')
    .select('*')
    .eq('participant_id', participant.id)
    .eq('status', 'completed')
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sError) return jsonError(sError.message, 500);
  if (!session) return jsonError('No completed result found for this code.', 404);

  return Response.json({
    success: true,
    result: {
      participant: { name: participant.name, usercode: participant.usercode, category: participant.category, paymentStatus: participant.payment_status },
      score: session.score || 0,
      maxScore: session.max_score || session.total_questions || 0,
      totalQuestions: session.total_questions || 0,
      percentage: percentage(session.score || 0, session.max_score || session.total_questions || 0),
      timeUsedSeconds: session.time_used_seconds || 0,
      submittedAt: session.submitted_at,
      proctoringSummary: session.proctoring_summary || {}
    }
  });
}
