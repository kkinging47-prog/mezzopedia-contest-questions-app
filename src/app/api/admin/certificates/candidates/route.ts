import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';
import { certificateDateForStage } from '@/lib/certificateDate';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const { data: configRows } = await supabaseAdmin
    .from('app_config')
    .select('key,value')
    .in('key', ['stageSettings', 'certificateSettings']);
  const config: Record<string, any> = {};
  for (const row of configRows || []) config[row.key] = row.value;

  const { data, error } = await supabaseAdmin
    .from('contest_sessions')
    .select('id,category,contest_stage,status,submitted_at, participant:participants(id,name,usercode,email,category)')
    .in('status', ['completed', 'expired'])
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false, nullsFirst: false });

  if (error) {
    return jsonError(`${error.message}. If the email column is missing, run supabase/run-this-certificate-email-fix.sql in Supabase SQL Editor.`, 500);
  }

  const candidates = (data || []).map((row: any) => ({
    sessionId: row.id,
    name: row.participant?.name || '',
    usercode: row.participant?.usercode || '',
    category: row.category || row.participant?.category || '',
    stage: row.contest_stage || '',
    certificateDate: certificateDateForStage(config.stageSettings, row.contest_stage || '', config.certificateSettings?.certificateDate || row.submitted_at || ''),
    email: row.participant?.email || '',
    submittedAt: row.submitted_at
  }));

  return Response.json({ success: true, candidates });
}
