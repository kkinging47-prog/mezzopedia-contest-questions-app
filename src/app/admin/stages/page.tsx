'use client';

import { useEffect, useMemo, useState } from 'react';
import { CONTEST_STAGES, DEFAULT_CATEGORIES } from '@/lib/constants';

type StageSummary = {
  stage: string;
  isOpen: boolean;
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

function formatSeconds(seconds: number) {
  const m = Math.floor((seconds || 0) / 60);
  const s = (seconds || 0) % 60;
  return `${m}m ${s}s`;
}

function nextStage(stage: string) {
  const index = CONTEST_STAGES.indexOf(stage as any);
  return CONTEST_STAGES[Math.min(index + 1, CONTEST_STAGES.length - 1)] || 'Stage 2';
}

export default function StageControlsPage() {
  const [summaries, setSummaries] = useState<StageSummary[]>([]);
  const [candidates, setCandidates] = useState<CompletedCandidate[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [activePhase, setActivePhase] = useState('Stage 1');
  const [fromStage, setFromStage] = useState('Stage 1');
  const [toStage, setToStage] = useState('Stage 2');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const selectedIds = useMemo(() => Object.entries(selected).filter(([, checked]) => checked).map(([id]) => id), [selected]);

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
    setSummaries(json.summaries || []);
    setCandidates(json.completedCandidates || []);
    setActivePhase(json.activePhase || 'Stage 1');
    setSelected({});
    setMessage('');
  }

  useEffect(() => { loadStageData(); }, []);

  async function setStageStatus(stage: string, isOpen: boolean, openOnlyThisStage = false) {
    const actionText = isOpen ? 'open' : 'close';
    const confirmText = openOnlyThisStage
      ? `Open only ${stage} and close the other stages?`
      : `${actionText.toUpperCase()} ${stage}?`;
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
    setMessage(`${stage} has been ${isOpen ? 'opened' : 'closed'}.`);
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
    if (!confirm(`Promote ${selectedIds.length} selected candidate(s) from ${fromStage} to ${toStage}? They will be able to login for ${toStage} when that stage is open.`)) return;
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
    setMessage(`Promoted ${json.promotedCount} candidate(s) to ${toStage}. Open ${toStage} when you are ready for them to begin.`);
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
            <h1 style={{ marginBottom: 6 }}>Open, close and promote contest stages</h1>
            <p className="muted">Use this page after each stage. Close the finished stage, select the qualified candidates, promote them to the next stage, then open the next stage.</p>
          </div>

          <div className="alert alert-info">
            <strong>Current active phase:</strong> {activePhase}. Candidates can only enter the stage assigned to their user code, and that stage must be open.
          </div>

          <div className="grid grid-3">
            {summaries.map(summary => <div key={summary.stage} className="card card-pad" style={{ boxShadow: 'none' }}>
              <div className="flex between wrap">
                <h3>{summary.stage}</h3>
                <span className={summary.isOpen ? 'badge badge-good' : 'badge badge-warn'}>{summary.isOpen ? 'OPEN' : 'CLOSED'}</span>
              </div>
              <p className="small muted">{summary.note || 'No note'}</p>
              <p><strong>{summary.participantCount}</strong> assigned candidates<br /><strong>{summary.activeParticipantCount}</strong> open codes<br /><strong>{summary.completedCount}</strong> completed submissions</p>
              <div className="flex wrap no-print">
                <button className="btn btn-primary" onClick={() => setStageStatus(summary.stage, true)} disabled={loading}>Open</button>
                <button className="btn btn-light" onClick={() => setStageStatus(summary.stage, false)} disabled={loading}>Close</button>
                <button className="btn btn-danger" onClick={() => setStageStatus(summary.stage, true, true)} disabled={loading}>Open only this</button>
              </div>
            </div>)}
          </div>
        </section>

        <section className="card card-pad grid">
          <div>
            <h2 style={{ marginBottom: 6 }}>Promote qualified candidates</h2>
            <p className="muted">Select completed candidates from the finished stage and promote only those who qualified to the next stage.</p>
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

          <div className="alert alert-info"><strong>Recommended workflow:</strong> close {fromStage}, select qualified candidates below, promote them to {toStage}, then open {toStage}. Non-promoted candidates remain in {fromStage} and cannot enter {toStage}.</div>

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
