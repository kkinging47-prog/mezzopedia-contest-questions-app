'use client';

import { useEffect, useMemo, useState } from 'react';
import { CONTEST_STAGES, DEFAULT_CATEGORIES, FINAL_TRIAL_STAGE } from '@/lib/constants';

type StageSummary = {
  stage: string;
  isOpen: boolean;
  manualOpen: boolean;
  scheduleStatus: 'open' | 'manual_closed' | 'not_started' | 'ended';
  accessMessage: string;
  startsAt?: string;
  endsAt?: string;
  note?: string;
  participantCount: number;
  activeParticipantCount: number;
  completedCount: number;
};

type CompletedCandidate = {
  sessionId: string;
  participantId: string;
  name: string;
  usercode: string;
  category: string;
  paymentStatus: string;
  currentStage: string;
  sessionStage: string;
  access: string;
  score: number;
  maxScore: number;
  percentage: number;
  timeUsedSeconds: number;
  submittedAt?: string | null;
};

type ScheduleDraft = { startsAt: string; endsAt: string };

function formatSeconds(seconds: number) {
  const m = Math.floor((seconds || 0) / 60);
  const s = (seconds || 0) % 60;
  return `${m}m ${s}s`;
}

function nextStage(stage: string) {
  const index = CONTEST_STAGES.indexOf(stage as any);
  return CONTEST_STAGES[Math.min(index + 1, CONTEST_STAGES.length - 1)] || 'Stage 1';
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toDatetimeLocal(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSchedule(value?: string) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function scheduleToIso(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function statusLabel(summary: StageSummary) {
  if (!summary.manualOpen) return 'CLOSED';
  if (summary.scheduleStatus === 'not_started') return 'SCHEDULED';
  if (summary.scheduleStatus === 'ended') return 'ENDED';
  return 'OPEN NOW';
}

function statusClass(summary: StageSummary) {
  if (summary.scheduleStatus === 'open') return 'badge badge-good';
  if (summary.scheduleStatus === 'ended') return 'badge badge-warn';
  return 'badge badge-warn';
}

export default function StageControlsPage() {
  const [summaries, setSummaries] = useState<StageSummary[]>([]);
  const [candidates, setCandidates] = useState<CompletedCandidate[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [activePhase, setActivePhase] = useState(FINAL_TRIAL_STAGE);
  const [fromStage, setFromStage] = useState(FINAL_TRIAL_STAGE);
  const [toStage, setToStage] = useState('Stage 1');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, ScheduleDraft>>({});

  const selectedIds = useMemo(() => Object.entries(selected).filter(([, checked]) => checked).map(([id]) => id), [selected]);
  const finalTrialSummary = summaries.find(summary => summary.stage === FINAL_TRIAL_STAGE);

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter(candidate => {
      const categoryOk = category === 'All' || candidate.category === category;
      const searchOk = !q || [candidate.name, candidate.usercode, candidate.category].some(value => String(value || '').toLowerCase().includes(q));
      return categoryOk && searchOk;
    });
  }, [candidates, category, search]);

  async function loadStageData(stage = fromStage, cat = category) {
    setLoading(true);
    setMessage('Loading stage controls...');
    const params = new URLSearchParams({ stage, category: cat });
    const res = await fetch(`/api/admin/stages?${params.toString()}`);
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMessage(json.error || 'Could not load stage controls. Make sure you are logged in as admin.');
      return;
    }
    const loadedSummaries = json.summaries || [];
    setSummaries(loadedSummaries);
    setCandidates(json.completedCandidates || []);
    setActivePhase(json.activePhase || FINAL_TRIAL_STAGE);
    setSelected({});
    const nextDrafts: Record<string, ScheduleDraft> = {};
    for (const summary of loadedSummaries) {
      nextDrafts[summary.stage] = { startsAt: toDatetimeLocal(summary.startsAt), endsAt: toDatetimeLocal(summary.endsAt) };
    }
    setScheduleDrafts(nextDrafts);
    setMessage('');
  }

  useEffect(() => { loadStageData(); }, []);

  async function setStageStatus(stage: string, isOpen: boolean, openOnlyThisStage = false) {
    const actionText = isOpen ? 'open' : 'close';
    const confirmText = openOnlyThisStage
      ? `Open only ${stage} and close the other stages? The schedule still controls the exact start/end time.`
      : `${actionText.toUpperCase()} ${stage}? The schedule still controls the exact start/end time.`;
    if (!confirm(confirmText)) return;
    setLoading(true);
    const res = await fetch('/api/admin/stages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setStageStatus', stage, isOpen, openOnlyThisStage })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMessage(json.error || 'Could not update stage status.');
      return;
    }
    setMessage(`${stage} has been ${isOpen ? 'opened' : 'closed'}. If a start/end schedule is set, candidates can only enter within that time window.`);
    loadStageData(fromStage, category);
  }

  async function assignAllToFinalTrial() {
    const warning = 'This will move ALL participant codes to Final Trial, reset their login count, cancel only active unfinished sessions, and open Final Trial. Use this before the main quiz begins. Continue?';
    if (!confirm(warning)) return;
    setLoading(true);
    const res = await fetch('/api/admin/stages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'assignAllToTrial' })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMessage(json.error || 'Could not assign candidates to Final Trial.');
      return;
    }
    setFromStage(FINAL_TRIAL_STAGE);
    setToStage('Stage 1');
    setMessage(`Assigned ${json.assignedCount || 0} participant code(s) to Final Trial. Upload/confirm 10 Final Trial questions per category, set the trial time, then let candidates log in.`);
    loadStageData(FINAL_TRIAL_STAGE, category);
  }

  function updateScheduleDraft(stage: string, field: keyof ScheduleDraft, value: string) {
    setScheduleDrafts(prev => ({ ...prev, [stage]: { ...(prev[stage] || { startsAt: '', endsAt: '' }), [field]: value } }));
  }

  async function saveSchedule(stage: string) {
    const draft = scheduleDrafts[stage] || { startsAt: '', endsAt: '' };
    if (draft.startsAt && draft.endsAt && new Date(draft.startsAt).getTime() >= new Date(draft.endsAt).getTime()) {
      setMessage(`${stage}: start time must be earlier than end time.`);
      return;
    }
    setLoading(true);
    const res = await fetch('/api/admin/stages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateStageSchedule', stage, startsAt: scheduleToIso(draft.startsAt), endsAt: scheduleToIso(draft.endsAt) })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMessage(json.error || 'Could not save stage schedule.');
      return;
    }
    setMessage(`${stage} schedule saved. Candidates assigned to ${stage} can only enter between the selected start and end time.`);
    loadStageData(fromStage, category);
  }

  async function clearSchedule(stage: string) {
    if (!confirm(`Clear the start and end time for ${stage}?`)) return;
    setScheduleDrafts(prev => ({ ...prev, [stage]: { startsAt: '', endsAt: '' } }));
    setLoading(true);
    const res = await fetch('/api/admin/stages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateStageSchedule', stage, startsAt: '', endsAt: '' })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMessage(json.error || 'Could not clear stage schedule.');
      return;
    }
    setMessage(`${stage} schedule cleared. Access will depend only on the Open/Close button.`);
    loadStageData(fromStage, category);
  }

  function selectTop(count: number) {
    const next: Record<string, boolean> = {};
    filteredCandidates.slice(0, count).forEach(candidate => { next[candidate.participantId] = true; });
    setSelected(next);
  }

  function toggleAll(checked: boolean) {
    const next: Record<string, boolean> = {};
    for (const candidate of filteredCandidates) next[candidate.participantId] = checked;
    setSelected(next);
  }

  async function promoteSelected() {
    if (!selectedIds.length) { setMessage('Select the qualified candidates first.'); return; }
    if (!confirm(`Promote ${selectedIds.length} selected candidate(s) from ${fromStage} to ${toStage}? They will be able to login for ${toStage} only when that stage is open and within the scheduled time.`)) return;
    setLoading(true);
    const res = await fetch('/api/admin/stages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promoteSelected', fromStage, toStage, participantIds: selectedIds })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMessage(json.error || 'Could not promote selected candidates.');
      return;
    }
    setSelected({});
    setMessage(`Promoted ${json.promotedCount} candidate(s) to ${toStage}. Open ${toStage} and set/confirm its schedule when you are ready.`);
    loadStageData(fromStage, category);
  }

  function changeFromStage(stage: string) {
    setFromStage(stage);
    setToStage(nextStage(stage));
    loadStageData(stage, category);
  }

  function changeCategory(cat: string) {
    setCategory(cat);
    loadStageData(fromStage, cat);
  }

  return (
    <main className="math-bg" style={{ paddingBottom: 40 }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Stage Controls</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin">Back to Admin</a>
            <button className="btn btn-light" onClick={() => loadStageData(fromStage, category)} disabled={loading}>Refresh</button>
          </div>
        </nav>

        {message && <div className="alert alert-info">{message}</div>}

        <section className="card card-pad grid" style={{ marginBottom: 18 }}>
          <div>
            <h1 style={{ marginBottom: 6 }}>Open, close, schedule and promote contest stages</h1>
            <p className="muted">Final Trial is now a separate stage before Stage 1. Upload 10 trial questions per category with phase/stage set to Final Trial, assign candidates to Final Trial, then promote them to Stage 1 before the main quiz.</p>
          </div>

          <div className="alert alert-info">
            <strong>Current active phase:</strong> {activePhase}. Time settings use the admin device time; for Ghana contests, enter Ghana local time.
          </div>

          <div className="card card-pad" style={{ boxShadow: 'none', border: '1px solid rgba(37,99,235,0.25)' }}>
            <h2 style={{ marginBottom: 6 }}>Final Trial setup</h2>
            <p className="muted">Use this before the main quiz. It moves every participant code to Final Trial so they can practise with your 10 trial questions per category. After the trial, choose Final Trial as the completed stage below, select candidates, and promote them to Stage 1.</p>
            <div className="flex wrap no-print">
              <button className="btn btn-primary" onClick={assignAllToFinalTrial} disabled={loading}>Assign All Participants to Final Trial</button>
              <button className="btn btn-light" onClick={() => { setFromStage(FINAL_TRIAL_STAGE); setToStage('Stage 1'); loadStageData(FINAL_TRIAL_STAGE, category); }} disabled={loading}>View Final Trial Results</button>
            </div>
            {finalTrialSummary && <p className="small muted" style={{ marginTop: 10 }}>Final Trial currently has <strong>{finalTrialSummary.participantCount}</strong> assigned participant code(s), <strong>{finalTrialSummary.activeParticipantCount}</strong> open code(s), and <strong>{finalTrialSummary.completedCount}</strong> completed submission(s).</p>}
          </div>

          <div className="grid grid-3">
            {summaries.map(summary => <div key={summary.stage} className="card card-pad" style={{ boxShadow: 'none' }}>
              <div className="flex between wrap">
                <h3>{summary.stage}</h3>
                <span className={statusClass(summary)}>{statusLabel(summary)}</span>
              </div>
              <p className="small muted">{summary.accessMessage}</p>
              <p className="small"><strong>Start:</strong> {formatSchedule(summary.startsAt)}<br /><strong>End:</strong> {formatSchedule(summary.endsAt)}</p>
              <p><strong>{summary.participantCount}</strong> assigned candidates<br /><strong>{summary.activeParticipantCount}</strong> open codes<br /><strong>{summary.completedCount}</strong> completed submissions</p>

              <div className="grid" style={{ gap: 10 }}>
                <label><span className="label">Stage Start Date/Time</span><input className="input" type="datetime-local" value={scheduleDrafts[summary.stage]?.startsAt || ''} onChange={e => updateScheduleDraft(summary.stage, 'startsAt', e.target.value)} /></label>
                <label><span className="label">Stage End Date/Time</span><input className="input" type="datetime-local" value={scheduleDrafts[summary.stage]?.endsAt || ''} onChange={e => updateScheduleDraft(summary.stage, 'endsAt', e.target.value)} /></label>
              </div>

              <div className="flex wrap no-print" style={{ marginTop: 12 }}>
                <button className="btn btn-primary" onClick={() => setStageStatus(summary.stage, true)} disabled={loading}>Open</button>
                <button className="btn btn-light" onClick={() => setStageStatus(summary.stage, false)} disabled={loading}>Close</button>
                <button className="btn btn-success" onClick={() => saveSchedule(summary.stage)} disabled={loading}>Save Time</button>
                <button className="btn btn-light" onClick={() => clearSchedule(summary.stage)} disabled={loading}>Clear Time</button>
                <button className="btn btn-danger" onClick={() => setStageStatus(summary.stage, true, true)} disabled={loading}>Open only this</button>
              </div>
            </div>)}
          </div>
        </section>

        <section className="card card-pad grid">
          <div>
            <h2 style={{ marginBottom: 6 }}>Promote qualified candidates</h2>
            <p className="muted">Select completed candidates from the finished stage and promote only those who qualified to the next stage. For the trial, choose Final Trial as the completed stage and promote candidates to Stage 1.</p>
          </div>

          <div className="grid grid-4">
            <label><span className="label">Completed Stage</span><select className="select" value={fromStage} onChange={e => changeFromStage(e.target.value)}>{CONTEST_STAGES.map(stage => <option key={stage}>{stage}</option>)}</select></label>
            <label><span className="label">Promote To</span><select className="select" value={toStage} onChange={e => setToStage(e.target.value)}>{CONTEST_STAGES.map(stage => <option key={stage}>{stage}</option>)}</select></label>
            <label><span className="label">Category</span><select className="select" value={category} onChange={e => changeCategory(e.target.value)}><option>All</option>{DEFAULT_CATEGORIES.map(cat => <option key={cat}>{cat}</option>)}</select></label>
            <label><span className="label">Search</span><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or code" /></label>
          </div>

          <div className="flex wrap no-print">
            <button className="btn btn-light" onClick={() => toggleAll(true)}>Select Shown</button>
            <button className="btn btn-light" onClick={() => toggleAll(false)}>Clear Selection</button>
            <button className="btn btn-light" onClick={() => selectTop(10)}>Select Top 10</button>
            <button className="btn btn-light" onClick={() => selectTop(20)}>Select Top 20</button>
            <button className="btn btn-primary" onClick={promoteSelected} disabled={loading || selectedIds.length === 0}>Promote Selected ({selectedIds.length})</button>
          </div>

          <div className="alert alert-info"><strong>Recommended workflow:</strong> upload Final Trial questions, assign all participants to Final Trial, set/open Final Trial, allow trial submissions, promote them from Final Trial to Stage 1, set/open Stage 1, then start the main quiz.</div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Select</th><th>Rank</th><th>Name</th><th>Code</th><th>Category</th><th>Stage Result</th><th>Score</th><th>Time</th><th>Submitted</th><th>Current Code Stage</th></tr>
              </thead>
              <tbody>
                {filteredCandidates.map((candidate, index) => <tr key={candidate.sessionId}>
                  <td><input type="checkbox" checked={Boolean(selected[candidate.participantId])} onChange={e => setSelected(prev => ({ ...prev, [candidate.participantId]: e.target.checked }))} /></td>
                  <td>{index + 1}</td>
                  <td>{candidate.name}</td>
                  <td><strong>{candidate.usercode}</strong></td>
                  <td>{candidate.category}</td>
                  <td>{candidate.sessionStage}</td>
                  <td>{candidate.score}/{candidate.maxScore}<div className="small muted">{candidate.percentage}%</div></td>
                  <td>{formatSeconds(candidate.timeUsedSeconds)}</td>
                  <td>{candidate.submittedAt ? new Date(candidate.submittedAt).toLocaleString() : ''}</td>
                  <td>{candidate.currentStage}</td>
                </tr>)}
                {!filteredCandidates.length && <tr><td colSpan={10} className="muted">No completed candidates found for this stage/category.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
