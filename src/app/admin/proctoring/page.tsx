'use client';

import { useEffect, useMemo, useState } from 'react';

type Evidence = {
  faceSnapshotUrl?: string;
  screenSnapshotUrl?: string;
  audioEvidenceUrl?: string;
  faceSnapshotPath?: string;
  screenSnapshotPath?: string;
  audioEvidencePath?: string;
};

type ProctorEvent = {
  id: string;
  eventType: string;
  severity: string;
  details: Record<string, unknown>;
  evidence: Evidence;
  createdAt: string;
  name: string;
  usercode: string;
  category: string;
  contestStage?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionStatus?: string;
};

const EVENT_EXPLANATIONS: Record<string, string> = {
  PROCTORING_STARTED: 'The candidate allowed proctoring permissions and started the monitored test session.',
  PERIODIC_PROCTORING_SNAPSHOT: 'Regular 10-second evidence snapshot captured from camera and screen where available.',
  TAB_SWITCH_OR_APP_BACKGROUND: 'The candidate left the test tab or the app went into the background.',
  WINDOW_BLUR_OR_EXTERNAL_APP_FOCUS: 'The test window lost focus, which may mean another app or browser window was opened.',
  PASTE_BLOCKED: 'The candidate attempted to paste content into the test page. The paste action was blocked.',
  COPY_OR_CUT_BLOCKED: 'The candidate attempted to copy or cut content from the test page. The action was blocked.',
  RIGHT_CLICK_BLOCKED: 'The candidate attempted to open the right-click menu. The action was blocked.',
  BLOCKED_KEYBOARD_SHORTCUT_OR_SCREENSHOT_ATTEMPT: 'A restricted keyboard shortcut or screenshot-related key was pressed.',
  FULLSCREEN_EXITED: 'The candidate exited fullscreen during the test.',
  FULLSCREEN_DECLINED: 'The candidate did not allow fullscreen mode.',
  POSSIBLE_SPLIT_SCREEN_OR_SMALL_WINDOW: 'The browser window became unusually small, which may indicate split screen or resizing.',
  POSSIBLE_DEVTOOLS_OR_SCREEN_OVERLAY_PANEL: 'The browser window size suggests developer tools, an overlay, or side panel may be open.',
  CAMERA_STOPPED_OR_BLOCKED: 'The camera feed stopped or became unavailable.',
  CAMERA_COVERED_OR_TOO_DARK: 'The camera image was too dark, which may mean the camera is covered or the room is too dark.',
  SURROUNDING_AUDIO_SPIKE_DETECTED: 'The microphone detected a loud sound around the candidate. A short audio clip may be available.',
  POSSIBLE_ANSWER_SPOKEN_OR_EXTERNAL_VOICE: 'Speech recognition detected possible answer words or a nearby voice. A short audio clip may be available.',
  SCREEN_SHARE_STOPPED: 'The candidate stopped screen sharing during the test.',
  SCREEN_SHARE_DECLINED: 'The candidate declined screen sharing on a device where screen sharing is required.',
  CAMERA_OR_MICROPHONE_DENIED: 'The candidate declined camera or microphone permission.',
  TEST_SUBMISSION_ATTEMPT: 'The candidate submitted or attempted to submit the test.'
};

function explain(eventType: string) {
  return EVENT_EXPLANATIONS[eventType] || eventType.replaceAll('_', ' ').toLowerCase();
}

function severityMeaning(severity: string) {
  const s = severity.toLowerCase();
  if (s === 'critical') return 'Critical: review immediately before accepting result.';
  if (s === 'high') return 'High: likely violation or serious risk.';
  if (s === 'medium') return 'Medium: suspicious behaviour that needs context.';
  return 'Low: informational monitoring record.';
}

export default function AdminProctoringReviewPage() {
  const [events, setEvents] = useState<ProctorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [search, setSearch] = useState('');

  async function loadEvents() {
    setLoading(true);
    setError('');
    const json = await fetch('/api/admin/proctoring').then(r => r.json()).catch(() => ({}));
    if (json.error) setError(json.error);
    setEvents(json.events || []);
    setLoading(false);
  }

  useEffect(() => { loadEvents(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(event => {
      const severityOk = severityFilter === 'All' || event.severity.toLowerCase() === severityFilter.toLowerCase();
      const searchOk = !q || [event.name, event.usercode, event.category, event.eventType].some(value => String(value || '').toLowerCase().includes(q));
      return severityOk && searchOk;
    });
  }, [events, search, severityFilter]);

  const counts = useMemo(() => ({
    total: events.length,
    critical: events.filter(e => e.severity === 'critical').length,
    high: events.filter(e => e.severity === 'high').length,
    audio: events.filter(e => e.evidence?.audioEvidenceUrl).length,
    images: events.filter(e => e.evidence?.faceSnapshotUrl || e.evidence?.screenSnapshotUrl).length
  }), [events]);

  return (
    <main className="math-bg" style={{ paddingBottom: 40 }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>AI Proctoring Review</strong>
          <div className="flex wrap"><a className="btn btn-light" href="/admin">Back to Admin</a><button className="btn btn-primary" onClick={loadEvents}>Refresh</button></div>
        </nav>

        <section className="grid grid-4">
          <Metric title="Total Events" value={String(counts.total)} />
          <Metric title="Critical" value={String(counts.critical)} />
          <Metric title="High" value={String(counts.high)} />
          <Metric title="Audio Clips" value={String(counts.audio)} />
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          <h1>Clear Explanation of Proctoring Records</h1>
          <div className="grid grid-2">
            <div className="alert alert-info"><strong>Face evidence</strong><br />Camera snapshots help confirm the candidate was present and that the camera was not covered.</div>
            <div className="alert alert-info"><strong>Screen evidence</strong><br />Screen snapshots help show whether the candidate stayed on the test page. This only works when screen sharing is allowed.</div>
            <div className="alert alert-info"><strong>Audio evidence</strong><br />Short clips are saved only when suspicious sound or possible spoken answers are detected. Use the audio player to listen later.</div>
            <div className="alert alert-info"><strong>Severity</strong><br />Critical and High events should be reviewed before finalizing a candidate’s result. Low events are mostly routine monitoring logs.</div>
          </div>
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          <div className="flex wrap no-print" style={{ marginBottom: 12 }}>
            <label style={{ minWidth: 220 }}><span className="label">Search candidate/code/event</span><input className="input" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <label style={{ minWidth: 180 }}><span className="label">Severity</span><select className="select" value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}>{['All','critical','high','medium','low'].map(s => <option key={s}>{s}</option>)}</select></label>
          </div>

          {loading && <div className="alert alert-info">Loading proctoring evidence...</div>}
          {error && <div className="alert alert-error">{error}</div>}

          <div className="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Candidate</th><th>Code</th><th>Stage</th><th>Violation</th><th>Meaning</th><th>Severity</th><th>Evidence</th><th>Details</th></tr></thead>
              <tbody>{filtered.map(event => <tr key={event.id}>
                <td>{new Date(event.createdAt).toLocaleString()}</td>
                <td>{event.name}</td>
                <td>{event.usercode}</td>
                <td>{event.contestStage || ''}</td>
                <td><strong>{event.eventType.replaceAll('_', ' ')}</strong></td>
                <td>{explain(event.eventType)}</td>
                <td><strong>{event.severity.toUpperCase()}</strong><br /><span className="small muted">{severityMeaning(event.severity)}</span></td>
                <td><EvidenceViewer evidence={event.evidence} /></td>
                <td><code className="small">{JSON.stringify(event.details || {}).slice(0, 240)}</code></td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return <div className="card card-pad" style={{ boxShadow: 'none', textAlign: 'center' }}><div className="muted small">{title}</div><h2>{value}</h2></div>;
}

function EvidenceViewer({ evidence }: { evidence: Evidence }) {
  const hasEvidence = evidence?.faceSnapshotUrl || evidence?.screenSnapshotUrl || evidence?.audioEvidenceUrl;
  if (!hasEvidence) return <span className="small muted">No file saved</span>;
  return <div className="grid" style={{ gap: 8 }}>
    <div className="flex wrap">
      {evidence.faceSnapshotUrl && <a className="btn btn-light" href={evidence.faceSnapshotUrl} target="_blank">View Face</a>}
      {evidence.screenSnapshotUrl && <a className="btn btn-light" href={evidence.screenSnapshotUrl} target="_blank">View Screen</a>}
      {evidence.audioEvidenceUrl && <a className="btn btn-light" href={evidence.audioEvidenceUrl} target="_blank">Open Audio</a>}
    </div>
    {evidence.audioEvidenceUrl && <audio controls preload="none" src={evidence.audioEvidenceUrl} style={{ width: 260 }} />}
  </div>;
}
