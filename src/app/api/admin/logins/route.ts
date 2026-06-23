import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';

function detectDevice(userAgent = '') {
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(ua)) return 'Tablet';
  if (/mobile|iphone|android/.test(ua)) return 'Mobile phone';
  if (/windows|macintosh|linux|x11/.test(ua)) return 'Laptop/Desktop';
  return 'Unknown device';
}

function detectBrowser(userAgent = '') {
  if (/edg\//i.test(userAgent)) return 'Microsoft Edge';
  if (/opr\//i.test(userAgent) || /opera/i.test(userAgent)) return 'Opera';
  if (/chrome\//i.test(userAgent) && !/chromium/i.test(userAgent)) return 'Chrome';
  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) return 'Safari';
  if (/firefox\//i.test(userAgent)) return 'Firefox';
  return 'Unknown browser';
}

function detectOS(userAgent = '') {
  if (/windows nt/i.test(userAgent)) return 'Windows';
  if (/android/i.test(userAgent)) return 'Android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS/iPadOS';
  if (/mac os x|macintosh/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return 'Unknown OS';
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const { data, error } = await supabaseAdmin
    .from('participant_login_events')
    .select('id,event_type,created_at,usercode,category,contest_stage,user_agent,details, participant:participants(id,name), session:contest_sessions(id,status)')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) return jsonError(error.message, 500);

  const events = (data || []).map((row: any) => {
    const userAgent = row.user_agent || '';
    return {
      id: row.id,
      eventType: row.event_type,
      createdAt: row.created_at,
      name: row.participant?.name || '',
      usercode: row.usercode,
      category: row.category,
      contestStage: row.contest_stage || '',
      sessionStatus: row.session?.status || '',
      userAgent,
      deviceType: detectDevice(userAgent),
      browserName: detectBrowser(userAgent),
      osName: detectOS(userAgent),
      details: row.details || {}
    };
  });

  return Response.json({ success: true, events });
}
