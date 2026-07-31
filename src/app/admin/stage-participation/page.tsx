'use client';

import { useEffect, useMemo, useState } from 'react';
import { CONTEST_STAGES, DEFAULT_CATEGORIES } from '@/lib/constants';

type ParticipationRow = {
  participantId: string;
  name: string;
  usercode: string;
  category: string;
  paymentStatus: string;
  currentStage: string;
  isActive: boolean;
  loginCount: number;
  lastLoginAt?: string;
  checkedStage: string;
  participationStatus: string;
  participationLabel: string;
  didStart: boolean;
  didSubmit: boolean;
  attemptCount: number;
  latestSessionId?: string;
  latestSessionStatus?: string;
  startedAt?: string;
  submittedAt?: string;
  updatedAt?: string;
  score: number;
  maxScore: number;
  percentage: number;
  timeUsedSeconds: number;
};

type Stats = Record<string, number>;

const statusOptions = [
  { value: 'not_submitted', label: 'Not submitted / did not complete' },
  { value: 'did_not_start', label: 'Did not start only' },
  { value: 'timed_out_or_not_submitted', label: 'Timed out / not submitted' },
  { value: 'in_progress', label: 'Started but still in progress' },
  { value: 'submitted', label: 'Submitted / took the stage' },
  { value: 'completed', label: 'Completed only' },
  { value: 'all', label: 'All paid candidates' }
];

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatTime(seconds: number) {
  const m = Math.floor((seconds || 0) / 60);
  const s = Math.floor((seconds || 0) % 60);
  return `${m}m ${s}s`;
}

function csvSafe(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function statusBadgeClass(status: string) {
  if (status === 'completed' || status === 'archived_submitted') return 'badge badge-good';
  if (status === 'did_not_start') return 'badge badge-warn';
  if (status === 'timed_out_or_not_submitted') return 'badge badge-warn';
  return 'badge';
}

export default function StageParticipationPage() {
  const [stage, setStage] = useState('Stage 1');
  const [category, setCategory] = useState('All');
  const [statusFilter, setStatusFilter] = useState('not_submitted');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ParticipationRow[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      const statusOk = statusFilter === 'all'
        || (statusFilter === 'not_submitted' && !row.didSubmit)
        || (statusFilter === 'submitted' && row.didSubmit)
        || row.participationStatus === statusFilter;
      const searchOk = !q || [row.name, row.usercode, row.category, row.currentStage, row.participationLabel]
        .some(value => String(value || '').toLowerCase().includes(q));
      return statusOk && searchOk;
    });
  }, [rows, search, statusFilter]);

  const selectedRows = useMemo(() => rows.filter(row => selectedIds.includes(row.participantId)), [rows, selectedIds]);

  async function loadRows(nextStage = stage, nextCategory = category) {
    setLoading(true);
    setError('');
    setMessage('Loading paid candidate participation...');
    const params = new URLSearchParams({ stage: nextStage, category: nextCategory });
    const res = await fetch(`/api/admin/stage-participation?${params.toString()}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(json.error || 'Could not load stage participation. Make sure you are logged in as admin.');
      setMessage('');
      return;
    }
    setRows(json.rows || []);
    setStats(json.stats || {});
    setSelectedIds([]);
    setMessage('');
  }

  useEffect(() => { loadRows(); }, []);

  function changeStage(value: string) {
    setStage(value);
    loadRows(value, category);
  }

  function changeCategory(value: string) {
    setCategory(value);
    loadRows(stage, value);
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  }

  function selectShown() {
    setSelectedIds(filteredRows.map(row => row.participantId));
  }

  function selectNotSubmitted() {
    setSelectedIds(filteredRows.filter(row => !row.didSubmit).map(row => row.participantId));
  }

  async function reopenParticipants(ids: string[], label = 'selected candidate(s)') {
    if (!ids.length) {
      setError('Select at least one paid candidate first.');
      return;
    }

    const warning = `Reopen ${stage} for ${ids.length} ${label}? This will assign them to ${stage}, open their code, reset login count, and archive any existing completed/unfinished ${stage} attempt so they can write again.`;
    if (!confirm(warning)) return;

    setLoading(true);
    setError('');
    setMessage(`Reopening ${stage} for selected paid candidates...`);
    const res = await fetch('/api/admin/stage-participation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reopenSelectedForStage', stage, participantIds: ids })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(json.error || `Could not reopen ${stage}.`);
      setMessage('');
      return;
    }
    setMessage(`${json.note || `Reopened ${stage}.`} Archived ${json.archivedTargetStageSessions || 0} old ${stage} attempt(s) and ${json.archivedOtherActiveSessions || 0} other active session(s).`);
    await loadRows(stage, category);
  }

  function exportCsv() {
    const headers = ['Name', 'Usercode', 'Category', 'Current Stage', 'Checked Stage', 'Payment', 'Participation Status', 'Attempts', 'Score', 'Percentage', 'Time Used', 'Started At', 'Submitted At', 'Last Login'];
    const body = filteredRows.map(row => [
      row.name,
      row.usercode,
      row.category,
      row.currentStage,
      row.checkedStage,
      row.paymentStatus,
      row.participationLabel,
      row.attemptCount,
      row.maxScore ? `${row.score}/${row.maxScore}` : '',
      row.maxScore ? `${row.percentage}%` : '',
      row.timeUsedSeconds ? formatTime(row.timeUsedSeconds) : '',
      formatDate(row.startedAt),
      formatDate(row.submittedAt),
      formatDate(row.lastLoginAt)
    ].map(csvSafe).join(','));

    const csv = [headers.map(csvSafe).join(','), ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `paid-${stage.toLowerCase().replaceAll(' ', '-')}-participation.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <main className="math-bg" style={{ paddingBottom: 40 }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Paid Stage Participation</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin">Back to Admin</a>
            <a className="btn btn-light" href="/admin/stages">Stage Controls</a>
            <button className="btn btn-light" onClick={() => loadRows(stage, category)} disabled={loading}>Refresh</button>
            <button className="btn btn-primary" onClick={exportCsv} disabled={!filteredRows.length}>Export CSV</button>
          </div>
        </nav>

        {message && <div className="alert alert-info">{message}</div>}
        {error && <div className="alert alert-error">{error}</div>}

        <section className="card card-pad grid">
          <div>
            <span className="badge">Paid candidates only</span>
            <h1 style={{ marginTop: 12 }}>Check who paid but did not take a stage</h1>
            <p className="muted">Choose any stage to see paid candidates who did not start, started but did not submit, timed out, or successfully submitted. You can reopen the selected stage for any paid candidate directly from this page.</p>
          </div>

          <div className="grid grid-4 no-print">
            <label>
              <span className="label">Stage to Check</span>
              <select className="select" value={stage} onChange={e => changeStage(e.target.value)}>
                {CONTEST_STAGES.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Category</span>
              <select className="select" value={category} onChange={e => changeCategory(e.target.value)}>
                {['All', ...DEFAULT_CATEGORIES].map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Participation Filter</span>
              <select className="select" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setSelectedIds([]); }}>
                {statusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Search</span>
              <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, code, category" />
            </label>
          </div>

          <div className="grid grid-4">
            <Metric title="Paid Candidates" value={String(stats.paid || 0)} />
            <Metric title="Submitted" value={String(stats.submitted || 0)} />
            <Metric title="Not Submitted" value={String(stats.notSubmitted || 0)} />
            <Metric title="Did Not Start" value={String(stats.didNotStart || 0)} />
          </div>

          <div className="alert alert-info">
            To allow someone to write {stage}, select them and click <strong>Reopen Selected for {stage}</strong>. After reopening, make sure {stage} is open in Stage Controls and the scheduled end time has not passed.
          </div>

          <div className="flex wrap no-print">
            <button className="btn btn-light" onClick={selectShown} disabled={!filteredRows.length || loading}>Select Shown</button>
            <button className="btn btn-light" onClick={selectNotSubmitted} disabled={!filteredRows.length || loading}>Select Not Submitted</button>
            <button className="btn btn-light" onClick={() => setSelectedIds([])} disabled={!selectedIds.length || loading}>Clear Selection</button>
            <button className="btn btn-primary" onClick={() => reopenParticipants(selectedIds, 'selected candidate(s)')} disabled={!selectedIds.length || loading}>Reopen Selected for {stage} ({selectedIds.length})</button>
          </div>
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          {loading && <div className="alert alert-info">Loading...</div>}
          {!loading && !filteredRows.length && <div className="alert alert-info">No paid candidates found for this filter.</div>}
          {!!filteredRows.length && <div className="table-wrap"><table>
            <thead>
              <tr>
                <th>Select</th><th>Name</th><th>Code</th><th>Category</th><th>Current Stage</th><th>Checked Stage</th><th>Participation</th><th>Attempts</th><th>Score</th><th>Started</th><th>Submitted</th><th>Last Login</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => <tr key={row.participantId}>
                <td><input type="checkbox" checked={selectedIds.includes(row.participantId)} onChange={() => toggleSelected(row.participantId)} /></td>
                <td>{row.name}</td>
                <td><strong>{row.usercode}</strong></td>
                <td>{row.category}</td>
                <td>{row.currentStage}<div className="small muted">{row.isActive ? 'Code open' : 'Code closed'}</div></td>
                <td>{row.checkedStage}</td>
                <td><span className={statusBadgeClass(row.participationStatus)}>{row.participationLabel}</span></td>
                <td>{row.attemptCount}</td>
                <td>{row.maxScore ? <><strong>{row.score}/{row.maxScore}</strong><div className="small muted">{row.percentage}% • {formatTime(row.timeUsedSeconds)}</div></> : '—'}</td>
                <td>{formatDate(row.startedAt)}</td>
                <td>{formatDate(row.submittedAt)}</td>
                <td>{formatDate(row.lastLoginAt)}</td>
                <td><button className="btn btn-light" onClick={() => reopenParticipants([row.participantId], row.name || row.usercode)} disabled={loading}>Reopen</button></td>
              </tr>)}
            </tbody>
          </table></div>}
        </section>
      </div>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return <div className="card card-pad" style={{ boxShadow: 'none', textAlign: 'center' }}><div className="muted small">{title}</div><h2>{value}</h2></div>;
}
