import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';
import { getActiveParticipantSession } from '@/lib/sessionGuard';

const allowedSeverities = new Set(['low', 'medium', 'high', 'critical']);
const MAX_DATA_URL_CHARS = 3_000_000;
const EVIDENCE_BUCKET = 'proctoring-evidence';

const mimeToExt: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'video/webm': 'webm'
};

function parseDataUrl(dataUrl?: string) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  if (dataUrl.length > MAX_DATA_URL_CHARS) return null;
  const match = dataUrl.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const ext = mimeToExt[mimeType];
  if (!ext) return null;
  return { mimeType, ext, data: Buffer.from(match[2], 'base64') };
}

async function uploadEvidence(sessionId: string, eventType: string, label: string, dataUrl?: string) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const cleanType = eventType.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  const path = `${sessionId}/${Date.now()}-${cleanType}-${label}.${parsed.ext}`;
  const { error } = await supabaseAdmin.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, parsed.data, { contentType: parsed.mimeType, upsert: false });
  if (error) return null;
  return path;
}

export async function POST(request: NextRequest) {
  const { token, session, error: guardError, status } = await getActiveParticipantSession(request, 'id,status,active_login_token');
  if (guardError || !session || !token) return jsonError(guardError || 'Not signed in.', status);

  const body = await request.json().catch(() => ({}));
  const eventType = String(body.eventType || 'UNKNOWN').slice(0, 80);
  const severity = allowedSeverities.has(String(body.severity)) ? String(body.severity) : 'medium';
  const rawDetails = body.details && typeof body.details === 'object' ? body.details : {};

  const [faceSnapshotPath, screenSnapshotPath, audioEvidencePath] = await Promise.all([
    uploadEvidence(session.id, eventType, 'face', rawDetails.faceSnapshotDataUrl),
    uploadEvidence(session.id, eventType, 'screen', rawDetails.screenSnapshotDataUrl),
    uploadEvidence(session.id, eventType, 'audio', rawDetails.audioEvidenceDataUrl)
  ]);

  const { faceSnapshotDataUrl, screenSnapshotDataUrl, audioEvidenceDataUrl, ...safeDetails } = rawDetails;
  const evidence = {
    ...(faceSnapshotPath ? { faceSnapshotPath } : {}),
    ...(screenSnapshotPath ? { screenSnapshotPath } : {}),
    ...(audioEvidencePath ? { audioEvidencePath } : {})
  };

  const { error } = await supabaseAdmin.from('proctoring_events').insert({
    session_id: token.sessionId,
    participant_id: token.participantId,
    event_type: eventType,
    severity,
    details: safeDetails,
    evidence,
    user_agent: request.headers.get('user-agent') || '',
    ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || ''
  });

  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true, evidence });
}
