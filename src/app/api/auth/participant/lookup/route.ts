import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, normalizeContestStage } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { usercode } = await request.json().catch(() => ({}));
  const code = String(usercode || '').trim();

  if (!code) return jsonError('Enter your user code first.');

  const { data, error } = await supabaseAdmin
    .from('participants')
    .select('name,usercode,category,payment_status,contest_stage,is_active')
    .ilike('usercode', code)
    .limit(3);

  if (error) return jsonError(error.message, 500);
  if (!data || data.length === 0) return jsonError('No participant found with this user code.', 404);
  if (data.length > 1) return jsonError('This user code appears in more than one category. Please contact the contest administrator to make the code unique.', 409);

  const participant = data[0];
  return Response.json({
    success: true,
    participant: {
      name: participant.name,
      usercode: participant.usercode,
      category: participant.category,
      paymentStatus: participant.payment_status || 'unpaid',
      contestStage: normalizeContestStage(participant.contest_stage || 'Stage 1'),
      isActive: Boolean(participant.is_active)
    }
  });
}
