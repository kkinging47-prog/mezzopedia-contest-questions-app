import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';

const EVIDENCE_BUCKET = 'proctoring-evidence';
const HIDDEN_PROCTORING_TYPES = new Set(['TEST_SUBMISSION_ATTEMPT']);

type ProctorEventRow = {
  id: string;
  participant_id?: string;
  event_type: string;
  severity: string;
  details: Record<string, unknown>;
  evidence: Record<string, string>;
  user_agent?: string;
  ip_address?: string;
  created_at: string;
  participant?: { id?: string; name?: string; usercode?: string; category?: string; contest_stage?: string };
  session?: { id?: string; category?: string; status?: string; contest_stage?: string };
};

function fileNameFromPath(path: string) {
  return path.split('/').pop() || 'proctoring-evidence';
}

async function signedUrl(path?: string, download = false) {
  if (!path || typeof path !== 'string') return '';
  // Old evidence records may already contain public URLs. Keep them working.
  if (path.startsWith('http://') || path.startsWith('https://')) return path;

  const options = download ? { download: fileNameFromPath(path) } : undefined;
  const { data, error } = await supabaseAdmin.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(path, 60 * 60, options as any);

  if (error) return '';
  return data?.signedUrl || '';
}

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

function deviceLabel(userAgent = '') {
  return `${detectDevice(userAgent)} / ${detectBrowser(userAgent)} / ${detectOS(userAgent)}`;
}

function eventToView(row: ProctorEventRow, evidence: Record<string, string>) {
  return {
    id: row.id,
    participantId: row.participant_id || row.participant?.id || '',
    eventType: row.event_type,
    severity: row.severity,
    details: row.details || {},
    evidence,
    userAgent: row.user_agent || '',
    ipAddress: row.ip_address || '',
    deviceSummary: deviceLabel(row.user_agent || ''),
    createdAt: row.created_at,
    sessionId: row.session?.id || '',
    sessionStatus: row.session?.status || '',
    category: row.session?.category || row.participant?.category || '',
    name: row.participant?.name || '',
    usercode: row.participant?.usercode || '',
    contestStage: row.session?.contest_stage || row.participant?.contest_stage || ''
  };
}

function emptySummary(event: any) {
  return {
    participantId: event.participantId || '',
    name: event.name || '',
    usercode: event.usercode || '',
    category: event.category || '',
    stages: new Set<string>(),
    ips: new Set<string>(),
    devices: new Set<string>(),
    totalEvents: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    audioClips: 0,
    imageEvidence: 0,
    repeatLogins: 0,
    loginCount: 0,
    byType: {} as Record<string, number>,
    lastEventAt: '',
    lastLoginAt: ''
  };
}

function summaryKey(event: any) {
  return event.participantId || event.usercode || `${event.name}-${event.category}` || 'unknown';
}

function buildSummaries(events: any[], loginEvents: any[]) {
  const map = new Map<string, ReturnType<typeof emptySummary>>();
  const ensure = (event: any) => {
    const key = summaryKey(event);
    if (!map.has(key)) map.set(key, emptySummary(event));
    const summary = map.get(key)!;
    summary.name ||= event.name || '';
    summary.usercode ||= event.usercode || '';
    summary.category ||= event.category || '';
    if (event.contestStage) summary.stages.add(event.contestStage);
    if (event.ipAddress) summary.ips.add(event.ipAddress);
    if (event.deviceSummary) summary.devices.add(event.deviceSummary);
    return summary;
  };

  for (const event of events) {
    const summary = ensure(event);
    summary.totalEvents += 1;
    if (event.severity === 'critical') summary.critical += 1;
    else if (event.severity === 'high') summary.high += 1;
    else if (event.severity === 'medium') summary.medium += 1;
    else summary.low += 1;
    if (event.evidence?.audioEvidenceUrl || event.evidence?.audioEvidencePath) summary.audioClips += 1;
    if (event.evidence?.faceSnapshotUrl || event.evidence?.screenSnapshotUrl || event.evidence?.faceSnapshotPath || event.evidence?.screenSnapshotPath) summary.imageEvidence += 1;
    summary.byType[event.eventType] = (summary.byType[event.eventType] || 0) + 1;
    if (!summary.lastEventAt || new Date(event.createdAt) > new Date(summary.lastEventAt)) summary.lastEventAt = event.createdAt;
  }

  for (const login of loginEvents) {
    const summary = ensure(login);
    summary.loginCount += 1;
    if (login.eventType === 'MULTIPLE_OR_REPEAT_LOGIN') summary.repeatLogins += 1;
    if (!summary.lastLoginAt || new Date(login.createdAt) > new Date(summary.lastLoginAt)) summary.lastLoginAt = login.createdAt;
  }

  return Array.from(map.values())
    .map(summary => ({
      ...summary,
      stages: Array.from(summary.stages),
      ips: Array.from(summary.ips),
      devices: Array.from(summary.devices),
      riskLevel: summary.critical ? 'CRITICAL' : summary.high ? 'HIGH' : summary.medium ? 'MEDIUM' : 'LOW'
    }))
    .sort((a, b) => b.critical - a.critical || b.high - a.high || b.totalEvents - a.totalEvents || a.name.localeCompare(b.name));
}

function evidencePaths(row: { evidence?: Record<string, string> }) {
  const evidence = row.evidence || {};
  return ['faceSnapshotPath', 'screenSnapshotPath', 'audioEvidencePath']
    .map(key => evidence[key])
    .filter((path): path is string => Boolean(path && typeof path === 'string' && !path.startsWith('http://') && !path.startsWith('https://')));
}

async function removeEvidenceFiles(rows: Array<{ evidence?: Record<string, string> }>) {
  const paths = Array.from(new Set(rows.flatMap(evidencePaths)));
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await supabaseAdmin.storage.from(EVIDENCE_BUCKET).remove(batch);
    if (!error) removed += batch.length;
  }
  return removed;
}

function cleanIds(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean)));
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const { data, error } = await supabaseAdmin
    .from('proctoring_events')
    .select('id,participant_id,event_type,severity,details,evidence,user_agent,ip_address,created_at, participant:participants(id,name,usercode,category,contest_stage), session:contest_sessions(id,category,status,contest_stage)')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) return jsonError(error.message, 500);

  const visibleRows = ((data || []) as ProctorEventRow[]).filter(row => !HIDDEN_PROCTORING_TYPES.has(row.event_type));
  const events = await Promise.all(visibleRows.map(async row => {
    const evidence = row.evidence || {};
    const faceSnapshotUrl = evidence.faceSnapshotUrl || await signedUrl(evidence.faceSnapshotPath);
    const screenSnapshotUrl = evidence.screenSnapshotUrl || await signedUrl(evidence.screenSnapshotPath);
    const audioEvidenceUrl = evidence.audioEvidenceUrl || await signedUrl(evidence.audioEvidencePath);
    const faceSnapshotDownloadUrl = evidence.faceSnapshotDownloadUrl || await signedUrl(evidence.faceSnapshotPath, true);
    const screenSnapshotDownloadUrl = evidence.screenSnapshotDownloadUrl || await signedUrl(evidence.screenSnapshotPath, true);
    const audioEvidenceDownloadUrl = evidence.audioEvidenceDownloadUrl || await signedUrl(evidence.audioEvidencePath, true);

    return eventToView(row, {
      ...evidence,
      ...(faceSnapshotUrl ? { faceSnapshotUrl } : {}),
      ...(screenSnapshotUrl ? { screenSnapshotUrl } : {}),
      ...(audioEvidenceUrl ? { audioEvidenceUrl } : {}),
      ...(faceSnapshotDownloadUrl ? { faceSnapshotDownloadUrl } : {}),
      ...(screenSnapshotDownloadUrl ? { screenSnapshotDownloadUrl } : {}),
      ...(audioEvidenceDownloadUrl ? { audioEvidenceDownloadUrl } : {})
    });
  }));

  const { data: loginRows } = await supabaseAdmin
    .from('participant_login_events')
    .select('id,event_type,created_at,usercode,category,contest_stage,user_agent,ip_address,details, participant:participants(id,name), session:contest_sessions(id,status)')
    .order('created_at', { ascending: false })
    .limit(1500);

  const loginEvents = (loginRows || []).map((row: any) => {
    const userAgent = row.user_agent || '';
    return {
      id: row.id,
      participantId: row.participant?.id || '',
      eventType: row.event_type,
      createdAt: row.created_at,
      name: row.participant?.name || '',
      usercode: row.usercode || '',
      category: row.category || '',
      contestStage: row.contest_stage || '',
      sessionStatus: row.session?.status || '',
      userAgent,
      ipAddress: row.ip_address || '',
      deviceSummary: deviceLabel(userAgent),
      details: row.details || {}
    };
  });

  return Response.json({ success: true, events, summaries: buildSummaries(events, loginEvents), loginEvents });
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || 'deleteIds');
  const ids = cleanIds(body.ids || body.eventIds);
  const usercode = String(body.usercode || '').trim();

  let rows: Array<{ id: string; evidence?: Record<string, string> }> = [];

  if (action === 'deleteAll') {
    const { data, error } = await supabaseAdmin.from('proctoring_events').select('id,evidence');
    if (error) return jsonError(error.message, 500);
    rows = data || [];
  } else if (action === 'deleteUsercode') {
    if (!usercode) return jsonError('Select a candidate/usercode to clear.', 400);
    const { data: participants, error: participantError } = await supabaseAdmin.from('participants').select('id').ilike('usercode', usercode);
    if (participantError) return jsonError(participantError.message, 500);
    const participantIds = (participants || []).map(row => row.id).filter(Boolean);
    if (!participantIds.length) return jsonError('No participant found for that usercode.', 404);
    const { data, error } = await supabaseAdmin.from('proctoring_events').select('id,evidence').in('participant_id', participantIds);
    if (error) return jsonError(error.message, 500);
    rows = data || [];
  } else {
    if (!ids.length) return jsonError('Select one or more proctoring records to clear.', 400);
    const { data, error } = await supabaseAdmin.from('proctoring_events').select('id,evidence').in('id', ids);
    if (error) return jsonError(error.message, 500);
    rows = data || [];
  }

  if (!rows.length) return Response.json({ success: true, deletedCount: 0, evidenceDeleted: 0 });

  const evidenceDeleted = await removeEvidenceFiles(rows);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map(row => row.id);
    const { error } = await supabaseAdmin.from('proctoring_events').delete().in('id', chunk);
    if (error) return jsonError(error.message, 500);
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    action: 'CLEAR_PROCTORING_RECORDS',
    entity_type: 'proctoring_event',
    details: { action, usercode, deletedCount: rows.length, evidenceDeleted }
  }).then(() => null);

  return Response.json({ success: true, deletedCount: rows.length, evidenceDeleted });
}
