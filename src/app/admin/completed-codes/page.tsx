'use client';

import { useEffect, useMemo, useState } from 'react';
import { CONTEST_STAGES, DEFAULT_CATEGORIES } from '@/lib/constants';

type CompletedCode = {
  sessionId: string;
  participantId: string;
  name: string;
  usercode: string;
  category: string;
  contestStage: string;
  paymentStatus: string;
  access: string;
  loginCount: number;
  lastLoginAt?: string | null;
  score: number;
  maxScore: number;
  percentage: number;
  timeUsedSeconds: number;
  startedAt: string;
  submittedAt?: string | null;
};

function formatSeconds(seconds: number) {
  const m = Math.floor((seconds || 0) / 60);
  const s = (seconds || 0) % 60;
  return `${m}m ${s}s`;
}

export default function CompletedCodesPage() {
  const [codes, setCodes] = useState<CompletedCode[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [category, setCategory] = useState('All');
  const [stage, setStage] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const selectedIds = useMemo(() => Object.entries(selected).filter(([, checked]) => checked).map(([id]) => id), [selected]);

  const filteredCodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return codes.filter(code => {
      const categoryOk = category === 'All' || code.category === category;
      const stageOk = stage === 'All' || code.contestStage === stage;
      const searchOk = !q || [code.name, code.usercode, code.category, code.contestStage].some(v => String(v || '').toLowerCase().includes(q));
      return categoryOk && stageOk && searchOk;
    });
  }, [codes, category, stage, search]);

  async function loadCodes() {
    setLoading(true);
    setMessage('Loading completed codes...');
    const params = new URLSearchParams();
    if (category !== 'All') params.set('category', category);
    if (stage !== 'All') params.set('stage', stage);
    const res = await fetch(`/api/admin/completed-codes?${params.toString()}`);
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMessage(json.error || 'Could not load completed codes. Make sure you are logged in as admin.');
      return;
    }
    setCodes(json.completedCodes || []);
    setMessage('');
  }

  useEffect(() => { loadCodes(); }, []);

  function toggleAll(checked: boolean) {
    const next: Record<string, boolean> = {};
    for (const code of filteredCodes) next[code.participantId] = checked;
    setSelected(next);
  }

  async function resetSelected() {
    if (!selectedIds.length) { setMessage('Select one or more completed codes first.'); return; }
    if (!confirm(`Reset ${selectedIds.length} selected code(s)? They will be able to take the test again, and their completed session will be removed from the active results list.`)) return;
    await resetCodes({ participantIds: selectedIds });
  }

  async function resetAll() {
    if (!filteredCodes.length) { setMessage('No completed codes match the current filter.'); return; }
    if (!confirm(`Reset ALL ${filteredCodes.length} completed code(s) currently shown? They will be able to retake the test.`)) return;
    await resetCodes({ resetAll: true, category, stage });
  }

  async function resetCodes(body: Record<string, unknown>) {
    setLoading(true);
    const res = await fetch('/api/admin/completed-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMessage(json.error || 'Reset failed.');
      return;
    }
    setSelected({});
    setMessage(`Reset ${json.resetCount} code(s). They can now login and retake the test.`);
    loadCodes();
  }

  return (
    <main className="math-bg" style={{ paddingBottom: 40 }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Completed Codes</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin">Back to Admin</a>
            <button className="btn btn-light" onClick={loadCodes} disabled={loading}>Refresh</button>
          </div>
        </nav>

        {message && <div className="alert alert-info">{message}</div>}

        <section className="card card-pad grid">
          <div>
            <h1 style={{ marginBottom: 6 }}>Completed user codes</h1>
            <p className="muted">These are candidates who have submitted the test. Their codes are closed so they cannot retake unless you reset them here.</p>
          </div>

          <div className="grid grid-4">
            <label><span className="label">Search</span><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or code" /></label>
            <label><span className="label">Category</span><select className="select" value={category} onChange={e => setCategory(e.target.value)}><option>All</option>{DEFAULT_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
            <label><span className="label">Stage</span><select className="select" value={stage} onChange={e => setStage(e.target.value)}><option>All</option>{CONTEST_STAGES.map(s => <option key={s}>{s}</option>)}</select></label>
            <div style={{ alignSelf: 'end' }}><button className="btn btn-light" onClick={loadCodes} disabled={loading}>Apply Filter</button></div>
          </div>

          <div className="flex wrap no-print">
            <button className="btn btn-light" onClick={() => toggleAll(true)}>Select Shown</button>
            <button className="btn btn-light" onClick={() => toggleAll(false)}>Clear Selection</button>
            <button className="btn btn-primary" onClick={resetSelected} disabled={loading || selectedIds.length === 0}>Reset Selected ({selectedIds.length})</button>
            <button className="btn btn-danger" onClick={resetAll} disabled={loading || filteredCodes.length === 0}>Reset All Shown ({filteredCodes.length})</button>
          </div>

          <div className="alert alert-info"><strong>What reset does:</strong> it re-opens the selected user code, clears its login count, and marks old sessions as cancelled so the candidate can start a fresh test. Export results first if you need a permanent copy of old scores.</div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Select</th><th>Name</th><th>Code</th><th>Category</th><th>Stage</th><th>Score</th><th>Time</th><th>Submitted</th><th>Access</th><th>Logins</th></tr>
              </thead>
              <tbody>
                {filteredCodes.map(code => <tr key={code.sessionId}>
                  <td><input type="checkbox" checked={Boolean(selected[code.participantId])} onChange={e => setSelected(prev => ({ ...prev, [code.participantId]: e.target.checked }))} /></td>
                  <td>{code.name}</td>
                  <td><strong>{code.usercode}</strong></td>
                  <td>{code.category}</td>
                  <td>{code.contestStage}</td>
                  <td>{code.score}/{code.maxScore}<div className="small muted">{code.percentage}%</div></td>
                  <td>{formatSeconds(code.timeUsedSeconds)}</td>
                  <td>{code.submittedAt ? new Date(code.submittedAt).toLocaleString() : ''}</td>
                  <td>{code.access}</td>
                  <td>{code.loginCount}</td>
                </tr>)}
                {!filteredCodes.length && <tr><td colSpan={10} className="muted">No completed codes found for the current filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
