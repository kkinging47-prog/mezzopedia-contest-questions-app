import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, percentage } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const { data, error } = await supabaseAdmin
    .from('contest_sessions')
    .select('id,category,status,started_at,submitted_at,time_used_seconds,score,max_score,total_questions,proctoring_summary, participant:participants(id,name,usercode,payment_status)')
    .in('status', ['completed', 'expired'])
    .order('score', { ascending: false, nullsFirst: false })
    .order('time_used_seconds', { ascending: true, nullsFirst: false })
    .order('submitted_at', { ascending: true, nullsFirst: false });

  if (error) return jsonError(error.message, 500);

  const results = (data || [])
    .map((row: any) => ({
      id: row.id,
      category: row.category,
      status: row.status,
      name: row.participant?.name || '',
      usercode: row.participant?.usercode || '',
      paymentStatus: row.participant?.payment_status || '',
      score: row.score || 0,
      maxScore: row.max_score || row.total_questions || 0,
      totalQuestions: row.total_questions || 0,
      percentage: percentage(row.score || 0, row.max_score || row.total_questions || 0),
      timeUsedSeconds: row.time_used_seconds || 0,
      startedAt: row.started_at,
      submittedAt: row.submitted_at,
      proctoringSummary: row.proctoring_summary || {}
    }))
    .sort((a, b) => b.score - a.score || a.timeUsedSeconds - b.timeUsedSeconds || a.name.localeCompare(b.name));

  return Response.json({ success: true, results, defaultOrder: 'highest_score_then_least_time' });
}
