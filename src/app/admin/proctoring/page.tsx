'use client';

import { useEffect, useMemo, useState } from 'react';

type Evidence = {
  faceSnapshotUrl?: string;
  screenSnapshotUrl?: string;
  audioEvidenceUrl?: string;
  faceSnapshotDownloadUrl?: string;
  screenSnapshotDownloadUrl?: string;
  audioEvidenceDownloadUrl?: string;
  faceSnapshotPath?: string;
  screenSnapshotPath?: string;
  audioEvidencePath?: string;
};

type ProctorEvent = {
  id: string;
  participantId?: string;
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
  deviceSummary?: string;
  sessionStatus?: string;
};

type ProctorSummary = {
  participantId?: string;
  name: string;
  usercode: string;
  category: string;
  stages: string[];
  ips: string[];
  devices: string[];
  totalEvents: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  audioClips: number;
  imageEvidence: number;
  repeatLogins: number;
  loginCount: number;
  riskLevel: string;
  byType: Record<string, number>;
  lastEventAt?: string;
  lastLoginAt?: string;
};

const EVENT_EXPLANATIONS: Record<string, string> = {
  PROCTORING_STARTED: 'The candidate allowed proctoring permissions and started the monitored test session.',
  PERIODIC_PROCTORING_SNAPSHOT: 'Regular evidence snapshot captured from camera and screen where available.',
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
  MULTIPLE_OR_REPEAT_USERCODE_LOGIN: 'The same usercode logged in again. The latest login invalidated the older browser session and the IP/device has been recorded.'
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

function formatDateTime(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export default function AdminProctoringReviewPage() {
  const [events, setEvents] = useState<ProctorEvent[]>([]);
  const [summaries, setSummaries] = useState<ProctorSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [search, setSearch] = useState('');

  async function loadEvents() {
    setLoading(true);
    setError('');
    const json = await fetch('/api/admin/proctoring').then(r => r.json()).catch(() => ({}));
    if (json.error) setError(json.error);
    setEvents(json.events || []);
    setSummaries(json.summaries || []);
    setSelectedIds([]);
    setLoading(false);
  }

  useEffect(() => { loadEvents(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(event => {
      const severityOk = severityFilter === 'All' || event.severity.toLowerCase() === severityFilter.toLowerCase();
      const searchOk = !q || [event.name, event.usercode, event.category, event.eventType, event.ipAddress, event.deviceSummary, event.contestStage].some(value => String(value || '').toLowerCase().includes(q));
      return severityOk && searchOk;
    });
  }, [events, search, severityFilter]);

  const filteredSummaries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return summaries;
    return summaries.filter(summary => [summary.name, summary.usercode, summary.category, summary.riskLevel, ...summary.ips, ...summary.devices, ...summary.stages]
      .some(value => String(value || '').toLowerCase().includes(q)));
  }, [summaries, search]);

  const counts = useMemo(() => ({
    total: events.length,
    candidates: summaries.length,
    critical: events.filter(e => e.severity === 'critical').length,
    high: events.filter(e => e.severity === 'high').length,
    audio: events.filter(e => e.evidence?.audioEvidenceUrl).length,
    images: events.filter(e => e.evidence?.faceSnapshotUrl || e.evidence?.screenSnapshotUrl).length,
    repeatLogins: summaries.reduce((sum, item) => sum + (item.repeatLogins || 0), 0)
  }), [events, summaries]);

  function toggleSelected(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  }

  function selectFiltered() {
    setSelectedIds(filtered.map(event => event.id));
  }

  async function clearRecords(action: string, payload: Record<string, unknown>, confirmText: string) {
    if (!confirm(confirmText)) return;
    setClearing(true);
    setError('');
    setMessage('Clearing proctoring records...');
    const res = await fetch('/api/admin/proctoring', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload })
    });
    const json = await res.json().catch(() => ({}));
    setClearing(false);
    if (!res.ok) { setError(json.error || 'Could not clear proctoring records.'); setMessage(''); return; }
    setMessage(`Cleared ${json.deletedCount || 0} proctoring record(s). Evidence files removed: ${json.evidenceDeleted || 0}.`);
    await loadEvents();
  }

  function clearSelected() {
    if (!selectedIds.length) { setError('Select one or more records first.'); return; }
    clearRecords('deleteIds', { ids: selectedIds }, `Clear ${selectedIds.length} selected proctoring record(s)? This cannot be undone.`);
  }

  function clearAll() {
    const typed = prompt('This will clear ALL proctoring records and evidence files. Type CLEAR ALL to continue.');
    if (typed !== 'CLEAR ALL') return;
    clearRecords('deleteAll', {}, 'Final confirmation: clear all proctoring records now?');
  }

  function clearCandidate(summary: ProctorSummary) {
    clearRecords('deleteUsercode', { usercode: summary.usercode }, `Clear all proctoring records for ${summary.name || summary.usercode}? This cannot be undone.`);
  }

  return (
    <main className="math-bg" style={{ paddingBottom: 40 }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>AI Proctoring Review</strong>
          <div className="flex wrap"><a className="btn btn-light" href="/admin">Back to Admin</a><button className="btn btn-primary" onClick={loadEvents}>Refresh</button></div>
        </nav>

        {message && <div className="alert alert-success">{message}</div>}
        {error && <div className="alert alert-error">{error}</div>}

        <section className="grid grid-4">
          <Metric title="Candidates" value={String(counts.candidates)} />
          <Metric title="Total Records" value={String(counts.total)} />
          <Metric title="Critical / High" value={`${counts.critical} / ${counts.high}`} />
          <Metric title="Repeat Logins" value={String(counts.repeatLogins)} />
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          <h1>Clear Explanation of Proctoring Records</h1>
          <div className="grid grid-2">
            <div className="alert alert-info"><strong>Face evidence</strong><br />Camera snapshots help confirm the candidate was present and that the camera was not covered. Use View or Download.</div>
            <div className="alert alert-info"><strong>Screen evidence</strong><br />Screen snapshots help show whether the candidate stayed on the test page. This only works when screen sharing is allowed.</div>
            <div className="alert alert-info"><strong>Audio evidence</strong><br />Short clips are saved only when suspicious sound or possible spoken answers are detected. If nobody speaks or makes a loud sound, no audio clip is created.</div>
            <div className="alert alert-info"><strong>Repeat login/IP summary</strong><br />When a candidate logs in again or from another device, the system records the IP address and device details for review.</div>
          </div>
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          <div className="flex between wrap no-print" style={{ marginBottom: 12 }}>
            <h2>Summary by Candidate</h2>
            <div className="flex wrap"><button className="btn btn-danger" disabled={clearing || !events.length} onClick={clearAll}>Clear All Proctoring</button></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Candidate</th><th>Code</th><th>Category/Stage</th><th>Risk</th><th>Events</th><th>Repeat Logins</th><th>IP Addresses</th><th>Devices</th><th>Last Activity</th><th>Action</th></tr></thead>
              <tbody>{filteredSummaries.map(summary => <tr key={summary.participantId || summary.usercode}>
                <td>{summary.name}</td>
                <td><strong>{summary.usercode}</strong></td>
                <td>{summary.category}<div className="small muted">{summary.stages.join(', ') || '—'}</div></td>
                <td><strong>{summary.riskLevel}</strong><div className="small muted">C:{summary.critical} H:{summary.high} M:{summary.medium} L:{summary.low}</div></td>
                <td>{summary.totalEvents}<div className="small muted">Images: {summary.imageEvidence}, Audio: {summary.audioClips}</div></td>
                <td>{summary.repeatLogins} / {summary.loginCount}</td>
                <td>{summary.ips.length ? summary.ips.join(', ') : 'No IP recorded yet'}</td>
                <td>{summary.devices.length ? summary.devices.join(' | ') : 'No device recorded yet'}</td>
                <td><span className="small">Event: {formatDateTime(summary.lastEventAt)}<br />Login: {formatDateTime(summary.lastLoginAt)}</span></td>
                <td><button className="btn btn-danger no-print" disabled={clearing} onClick={() => clearCandidate(summary)}>Clear Candidate</button></td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          <div className="flex wrap no-print" style={{ marginBottom: 12 }}>
            <label style={{ minWidth: 260 }}><span className="label">Search candidate/code/IP/device/event</span><input className="input" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <label style={{ minWidth: 180 }}><span className="label">Severity</span><select className="select" value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}>{['All','critical','high','medium','low'].map(s => <option key={s}>{s}</option>)}</select></label>
            <button className="btn btn-light" onClick={selectFiltered} disabled={!filtered.length || clearing} style={{ alignSelf: 'end' }}>Select Filtered</button>
            <button className="btn btn-light" onClick={() => setSelectedIds([])} disabled={!selectedIds.length || clearing} style={{ alignSelf: 'end' }}>Clear Selection</button>
            <button className="btn btn-danger" onClick={clearSelected} disabled={!selectedIds.length || clearing} style={{ alignSelf: 'end' }}>{clearing ? 'Clearing...' : `Clear Selected (${selectedIds.length})`}</button>
          </div>

          {loading && <div className="alert alert-info">Loading proctoring evidence...</div>}

          <div className="table-wrap">
            <table>
              <thead><tr><th>Select</th><th>Time</th><th>Candidate</th><th>Code</th><th>Stage</th><th>Record</th><th>Meaning</th><th>Severity</th><th>IP/Device</th><th>Evidence</th><th>Details</th></tr></thead>
              <tbody>{filtered.map(event => <tr key={event.id}>
                <td><input type="checkbox" checked={selectedIds.includes(event.id)} onChange={() => toggleSelected(event.id)} /></td>
                <td>{formatDateTime(event.createdAt)}</td>
                <td>{event.name}</td>
                <td>{event.usercode}</td>
                <td>{event.contestStage || ''}</td>
                <td><strong>{event.eventType.replaceAll('_', ' ')}</strong></td>
                <td>{explain(event.eventType)}</td>
                <td><strong>{event.severity.toUpperCase()}</strong><br /><span className="small muted">{severityMeaning(event.severity)}</span></td>
                <td><strong>{event.ipAddress || 'No IP'}</strong><br /><span className="small muted">{event.deviceSummary || event.userAgent || 'No device'}</span></td>
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
      {evidence.faceSnapshotUrl && <a className="btn btn-light" href={evidence.faceSnapshotUrl} target="_blank" rel="noreferrer">View Face</a>}
      {evidence.faceSnapshotDownloadUrl && <a className="btn btn-success" href={evidence.faceSnapshotDownloadUrl}>Download Face</a>}
      {evidence.screenSnapshotUrl && <a className="btn btn-light" href={evidence.screenSnapshotUrl} target="_blank" rel="noreferrer">View Screen</a>}
      {evidence.screenSnapshotDownloadUrl && <a className="btn btn-success" href={evidence.screenSnapshotDownloadUrl}>Download Screen</a>}
      {evidence.audioEvidenceUrl && <a className="btn btn-light" href={evidence.audioEvidenceUrl} target="_blank" rel="noreferrer">Open Audio</a>}
      {evidence.audioEvidenceDownloadUrl && <a className="btn btn-success" href={evidence.audioEvidenceDownloadUrl}>Download Audio</a>}
    </div>
    {evidence.audioEvidenceUrl && <audio controls preload="none" src={evidence.audioEvidenceUrl} style={{ width: 260 }} />}
  </div>;
}
