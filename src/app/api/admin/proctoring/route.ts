import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';

const EVIDENCE_BUCKET = 'proctoring-evidence';

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

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const { data, error } = await supabaseAdmin
    .from('proctoring_events')
    .select('id,event_type,severity,details,evidence,user_agent,ip_address,created_at, session:contest_sessions(id,category,status, participant:participants(id,name,usercode,category,contest_stage))')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) return jsonError(error.message, 500);

  const events = await Promise.all((data || []).map(async (row: any) => {
    const evidence = row.evidence || {};
    const faceSnapshotUrl = evidence.faceSnapshotUrl || await signedUrl(evidence.faceSnapshotPath);
    const screenSnapshotUrl = evidence.screenSnapshotUrl || await signedUrl(evidence.screenSnapshotPath);
    const audioEvidenceUrl = evidence.audioEvidenceUrl || await signedUrl(evidence.audioEvidencePath);
    const faceSnapshotDownloadUrl = evidence.faceSnapshotDownloadUrl || await signedUrl(evidence.faceSnapshotPath, true);
    const screenSnapshotDownloadUrl = evidence.screenSnapshotDownloadUrl || await signedUrl(evidence.screenSnapshotPath, true);
    const audioEvidenceDownloadUrl = evidence.audioEvidenceDownloadUrl || await signedUrl(evidence.audioEvidencePath, true);

    return {
      id: row.id,
      eventType: row.event_type,
      severity: row.severity,
      details: row.details || {},
      evidence: {
        ...evidence,
        ...(faceSnapshotUrl ? { faceSnapshotUrl } : {}),
        ...(screenSnapshotUrl ? { screenSnapshotUrl } : {}),
        ...(audioEvidenceUrl ? { audioEvidenceUrl } : {}),
        ...(faceSnapshotDownloadUrl ? { faceSnapshotDownloadUrl } : {}),
        ...(screenSnapshotDownloadUrl ? { screenSnapshotDownloadUrl } : {}),
        ...(audioEvidenceDownloadUrl ? { audioEvidenceDownloadUrl } : {})
      },
      userAgent: row.user_agent || '',
      ipAddress: row.ip_address || '',
      createdAt: row.created_at,
      sessionId: row.session?.id || '',
      sessionStatus: row.session?.status || '',
      category: row.session?.category || row.session?.participant?.category || '',
      name: row.session?.participant?.name || '',
      usercode: row.session?.participant?.usercode || '',
      contestStage: row.session?.participant?.contest_stage || ''
    };
  }));

  return Response.json({ success: true, events });
}
