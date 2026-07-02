import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const { data, error } = await supabaseAdmin
    .from('contest_sessions')
    .select('id,category,status,submitted_at, participant:participants(id,name,usercode,email,category)')
    .eq('status', 'completed')
    .order('submitted_at', { ascending: false, nullsFirst: false });

  if (error) {
    return jsonError(`${error.message}. If the email column is missing, run supabase/run-this-certificate-email-fix.sql in Supabase SQL Editor.`, 500);
  }

  const candidates = (data || []).map((row: any) => ({
    sessionId: row.id,
    name: row.participant?.name || '',
    usercode: row.participant?.usercode || '',
    category: row.category || row.participant?.category || '',
    email: row.participant?.email || '',
    submittedAt: row.submitted_at
  }));

  return Response.json({ success: true, candidates });
}
