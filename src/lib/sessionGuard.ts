import { NextRequest } from 'next/server';
import { requireParticipant, ParticipantTokenPayload } from './auth';
import { supabaseAdmin } from './supabaseAdmin';

type GuardResult = {
  token: ParticipantTokenPayload | null;
  session: any | null;
  error: string | null;
  status: number;
};

export async function getActiveParticipantSession(request: NextRequest, select = '*'): Promise<GuardResult> {
  const token = await requireParticipant(request);
  if (!token) return { token: null, session: null, error: 'Not signed in.', status: 401 };

  const { data: session, error } = await supabaseAdmin
    .from('contest_sessions')
    .select(select)
    .eq('id', token.sessionId)
    .single();

  if (error || !session) return { token, session: null, error: 'Session not found.', status: 404 };
  const sessionData: any = session;
  if (sessionData.active_login_token && sessionData.active_login_token !== token.loginToken) {
    return { token, session: sessionData, error: 'This code has been used to sign in on another device or browser. Only the latest login can continue.', status: 409 };
  }
  return { token, session: sessionData, error: null, status: 200 };
}
