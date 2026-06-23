import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const { data, error } = await supabaseAdmin
    .from('proctoring_events')
    .select('id,event_type,severity,details,evidence,user_agent,ip_address,created_at, session:contest_sessions(id,category,status, participant:participants(id,name,usercode,category,contest_stage))')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) return jsonError(error.message, 500);

  const events = (data || []).map((row: any) => ({
    id: row.id,
    eventType: row.event_type,
    severity: row.severity,
    details: row.details || {},
    evidence: row.evidence || {},
    userAgent: row.user_agent || '',
    ipAddress: row.ip_address || '',
    createdAt: row.created_at,
    sessionId: row.session?.id || '',
    sessionStatus: row.session?.status || '',
    category: row.session?.category || row.session?.participant?.category || '',
    name: row.session?.participant?.name || '',
    usercode: row.session?.participant?.usercode || '',
    contestStage: row.session?.participant?.contest_stage || ''
  }));

  return Response.json({ success: true, events });
}
