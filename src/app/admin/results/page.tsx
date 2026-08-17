'use client';

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { CONTEST_STAGES, DEFAULT_CATEGORIES, MAIN_CONTEST_STAGES } from '@/lib/constants';

type Result = {
  id: string;
  participantId: string;
  name: string;
  usercode: string;
  category: string;
  sessionStage: string;
  currentStage: string;
  paymentStatus: string;
  isActive: boolean;
  status?: string;
  score: number;
  maxScore: number;
  totalQuestions: number;
  percentage: number;
  timeUsedSeconds: number;
  submittedAt: string;
  attemptCount?: number;
  hiddenAttemptCount?: number;
  proctoringSummary?: { riskLevel?: string; total?: number };
};

type ResultStats = {
  allSessionCount: number;
  duplicateAttemptCount: number;
  dedupeRule?: string;
};

function formatTime(seconds: number) {
  const m = Math.floor((seconds || 0) / 60);
  const s = (seconds || 0) % 60;
  return `${m}m ${s}s`;
}

function formatSubmitted(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function stageIndex(stage: string) {
  return (CONTEST_STAGES as readonly string[]).indexOf(stage);
}

function canPromote(result: Result, targetStage: string) {
  const forward = stageIndex(targetStage) > stageIndex(result.sessionStage || 'Stage 1');
  if (!forward) return false;
  if (result.status === 'completed') return true;

  // If a Stage 3 candidate was promoted to Live Finals, then removed, the Stage 3
  // result may already be archived. Allow that archived Stage 3 result to be selected
  // again for Live Finals without forcing the candidate to rewrite Stage 3.
  return targetStage === 'Live Finals'
    && result.status === 'expired'
    && result.sessionStage === 'Stage 3'
    && result.currentStage === 'Stage 3';
}

function defaultTargetForCompletedStage(completedStage: string) {
  if (!completedStage || completedStage === 'All') return 'Live Finals';
  const stages = CONTEST_STAGES as readonly string[];
  const mainStages = MAIN_CONTEST_STAGES as readonly string[];
  const nextStage = stages[stages.indexOf(completedStage) + 1];
  return nextStage && mainStages.includes(nextStage) ? nextStage : 'Live Finals';
}

function dateStartMs(value: string) {
  if (!value) return null;
  const ms = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function dateEndMs(value: string) {
  if (!value) return null;
  const ms = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isWithinDateRange(result: Result, dateFrom: string, dateTo: string) {
  if (!dateFrom && !dateTo) return true;
  if (!result.submittedAt) return false;
  const submitted = new Date(result.submittedAt).getTime();
  if (!Number.isFinite(submitted)) return false;
  const start = dateStartMs(dateFrom);
  const end = dateEndMs(dateTo);
  if (start !== null && submitted < start) return false;
  if (end !== null && submitted > end) return false;
  return true;
}

function rankResults(results: Result[], category: string, stage: string, dateFrom: string, dateTo: string) {
  const filtered = results
    .filter(result => category === 'All' || result.category === category)
    .filter(result => stage === 'All' || result.sessionStage === stage)
    .filter(result => isWithinDateRange(result, dateFrom, dateTo));
  return filtered.sort((a, b) => b.score - a.score || a.timeUsedSeconds - b.timeUsedSeconds || a.name.localeCompare(b.name));
}

function fileSafe(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all';
}

function dateFilterLabel(dateFrom: string, dateTo: string) {
  if (!dateFrom && !dateTo) return 'All dates';
  if (dateFrom && dateTo) return `${dateFrom} to ${dateTo}`;
  if (dateFrom) return `From ${dateFrom}`;
  return `Up to ${dateTo}`;
}

export default function AdminResultsPage() {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('All');
  const [stage, setStage] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [targetStage, setTargetStage] = useState('Live Finals');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [stats, setStats] = useState<ResultStats>({ allSessionCount: 0, duplicateAttemptCount: 0 });

  const rankedResults = useMemo(() => rankResults(results, category, stage, dateFrom, dateTo), [results, category, stage, dateFrom, dateTo]);
  const eligibleResults = useMemo(() => rankedResults.filter(result => canPromote(result, targetStage)), [rankedResults, targetStage]);
  const selectedResults = useMemo(() => results.filter(result => selectedIds.includes(result.id)), [results, selectedIds]);
  const activeFilterLabel = `${category === 'All' ? 'All categories' : category} / ${stage === 'All' ? 'All stages' : stage} / ${dateFilterLabel(dateFrom, dateTo)}`;

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) throw new Error('Admin login required.');
      setReady(true);
      return loadResults();
    }).catch(err => {
      setError(err.message || 'Could not verify admin session.');
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    setSelectedIds(prev => prev.filter(id => rankedResults.some(result => result.id === id && canPromote(result, targetStage))));
  }, [rankedResults, targetStage]);

  function clearDateFilter() {
    setDateFrom('');
    setDateTo('');
  }

  function changeCompletedStage(value: string) {
    setStage(value);
    setTargetStage(defaultTargetForCompletedStage(value));
    setSelectedIds([]);
  }

  async function loadResults() {
    setLoading(true);
    setMessage('Loading ranked results...');
    const json = await fetch('/api/admin/results').then(res => res.json()).catch(() => ({}));
    setLoading(false);
    if (json.error) { setError(json.error); setMessage(''); return; }
    setResults(json.results || []);
    setStats({ allSessionCount: json.allSessionCount || (json.results || []).length, duplicateAttemptCount: json.duplicateAttemptCount || 0, dedupeRule: json.dedupeRule || '' });
    setMessage('');
  }

  function exportExcel() {
    const rows = rankedResults.map((result, index) => ({
      Rank: index + 1,
      Name: result.name,
      Usercode: result.usercode,
      Category: result.category,
      'Completed Stage': result.sessionStage,
      'Current Assigned Stage': result.currentStage,
      'Payment Status': result.paymentStatus,
      Status: result.status,
      Score: result.score,
      'Max Score': result.maxScore,
      Percentage: `${result.percentage}%`,
      'Time Used': formatTime(result.timeUsedSeconds),
      'Time Used Seconds': result.timeUsedSeconds,
      'Submission Date': formatSubmitted(result.submittedAt),
      'Submitted At Raw': result.submittedAt,
      'Attempts Recorded': result.attemptCount || 1,
      'Hidden Duplicate Attempts': result.hiddenAttemptCount || 0,
      'Proctoring Risk': result.proctoringSummary?.riskLevel || 'LOW',
      'Proctoring Events': result.proctoringSummary?.total || 0
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Ranked Results');
    XLSX.writeFile(workbook, `mezzopedia-ranked-results-${fileSafe(category)}-${fileSafe(stage)}-${fileSafe(dateFilterLabel(dateFrom, dateTo))}.xlsx`);
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  }

  function selectEligibleShown() {
    setSelectedIds(eligibleResults.map(result => result.id));
  }

  function selectTop(count: number) {
    setSelectedIds(eligibleResults.slice(0, count).map(result => result.id));
  }

  async function promoteSelected() {
    setError('');
    setMessage('');
    const invalid = selectedResults.filter(result => !canPromote(result, targetStage));
    if (!selectedIds.length) { setError('Select one or more eligible completed results first.'); return; }
    if (invalid.length) { setError('Some selected rows cannot be promoted to the selected target stage. Clear selection and choose eligible rows.'); return; }

    const unpaidCount = selectedResults.filter(result => result.paymentStatus !== 'paid').length;
    const warning = unpaidCount
      ? `\n\nNote: ${unpaidCount} selected candidate(s) are not paid yet. They will be moved to ${targetStage}, but the login rules will still block them from the main stage until payment is marked paid.`
      : '';

    if (!confirm(`Promote ${selectedIds.length} selected candidate(s) to ${targetStage}? Their result will remain available for reporting, and their code will be moved to the target stage.${warning}`)) return;

    setPromoting(true);
    const res = await fetch('/api/admin/results/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: selectedIds, targetStage })
    });
    const json = await res.json().catch(() => ({}));
    setPromoting(false);
    if (!res.ok) { setError(json.error || 'Could not promote selected candidates.'); return; }
    setSelectedIds([]);
    setMessage(`Promoted ${json.promotedCount || selectedIds.length} candidate(s) to ${json.targetStage || targetStage}. ${json.note || ''}`.trim());
    loadResults();
  }

  if (error && !ready && !loading) {
    return <main className="math-bg centered"><div className="card card-pad"><div className="alert alert-error">{error}</div><a className="btn btn-primary" href="/admin">Back to Admin</a></div></main>;
  }

  return (
    <main className="math-bg" style={{ paddingBottom: 40 }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Ranked Results</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin">Back to Admin</a>
            <a className="btn btn-light" href="/admin/stages">Stage Controls</a>
            <button className="btn btn-light" onClick={loadResults} disabled={loading}>Refresh</button>
            <button className="btn btn-primary" onClick={exportExcel} disabled={!rankedResults.length}>Export Excel</button>
          </div>
        </nav>

        {message && <div className="alert alert-info">{message}</div>}
        {error && ready && <div className="alert alert-error">{error}</div>}

        <section className="card card-pad grid">
          <div>
            <span className="badge">Official ranking order</span>
            <h1 style={{ marginTop: 12 }}>Results ranked by highest score, then least time</h1>
            <p className="muted">Use the filters below to view results by category, completed stage, or submission date/date range. The default order is always highest score first; if scores are tied, the candidate who used the least time comes first.</p>
            <div className="alert alert-info">Duplicate-looking rows happen when one candidate has more than one saved session/result. The results page now shows only one official row per participant per completed stage, while counting hidden duplicate attempts for review.</div>
          </div>

          <div className="grid grid-4 no-print">
            <label>
              <span className="label">Filter by Category</span>
              <select className="select" value={category} onChange={e => setCategory(e.target.value)}>
                {['All', ...DEFAULT_CATEGORIES].map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Filter by Completed Stage</span>
              <select className="select" value={stage} onChange={e => changeCompletedStage(e.target.value)}>
                {['All', ...CONTEST_STAGES].map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Submission Date From</span>
              <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </label>
            <label>
              <span className="label">Submission Date To</span>
              <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </label>
            <label>
              <span className="label">Promote Selected To</span>
              <select className="select" value={targetStage} onChange={e => { setTargetStage(e.target.value); setSelectedIds([]); }}>
                {MAIN_CONTEST_STAGES.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
            <div className="flex wrap" style={{ alignSelf: 'end' }}>
              <button className="btn btn-light" onClick={clearDateFilter} disabled={!dateFrom && !dateTo}>Clear Date</button>
            </div>
          </div>

          <div className="alert alert-info no-print"><strong>Active filter:</strong> {activeFilterLabel}</div>

          <div className="grid grid-4">
            <Metric title="Official Results" value={String(results.length)} />
            <Metric title="Showing" value={String(rankedResults.length)} />
            <Metric title="Eligible for Target" value={String(eligibleResults.length)} />
            <Metric title="Order" value="Score ↓ / Time ↑" />
          </div>
        </section>

        <section className="card card-pad no-print" style={{ marginTop: 18 }}>
          <h2>Promote passed candidates</h2>
          <p className="muted">Select completed candidates below and promote them to Stage 1, Stage 2, Stage 3 or Live Finals. The system only allows forward promotion. If a candidate was removed from Live Finals, their archived Stage 3 result can still be selected again for Live Finals.</p>
          <div className="alert alert-info">For Live Finals, set <strong>Filter by Completed Stage</strong> to <strong>Stage 3</strong>, set <strong>Promote Selected To</strong> to <strong>Live Finals</strong>, then select the qualified candidates. Candidates removed from Live Finals will show as <strong>Archived / promoted</strong>, but they can now be selected again if their current stage is Stage 3.</div>
          <div className="flex wrap">
            <button className="btn btn-light" onClick={selectEligibleShown} disabled={!eligibleResults.length || promoting}>Select Eligible Shown</button>
            <button className="btn btn-light" onClick={() => selectTop(10)} disabled={!eligibleResults.length || promoting}>Select Top 10 Eligible</button>
            <button className="btn btn-light" onClick={() => selectTop(20)} disabled={!eligibleResults.length || promoting}>Select Top 20 Eligible</button>
            <button className="btn btn-light" onClick={() => setSelectedIds([])} disabled={!selectedIds.length || promoting}>Clear Selection</button>
            <button className="btn btn-primary" onClick={promoteSelected} disabled={!selectedIds.length || promoting}>{promoting ? 'Promoting...' : `Promote Selected (${selectedIds.length})`}</button>
          </div>
          <div className="alert alert-info" style={{ marginTop: 14 }}>Payment rule still applies: unpaid or pending candidates may be moved to a main stage, but they cannot enter the main stage until their payment status is changed to paid.</div>
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          {loading && <div className="alert alert-info">Loading results...</div>}
          {!loading && !rankedResults.length && <div className="alert alert-info">No results found for this filter.</div>}
          {!!rankedResults.length && <div className="table-wrap"><table>
            <thead><tr><th>Select</th><th>Rank</th><th>Name</th><th>Code</th><th>Category</th><th>Completed Stage</th><th>Current Stage</th><th>Payment</th><th>Score</th><th>%</th><th>Time Used</th><th>Submission Date</th><th>Attempts</th><th>Status</th><th>Risk</th></tr></thead>
            <tbody>{rankedResults.map((result, index) => {
              const eligible = canPromote(result, targetStage);
              return <tr key={result.id}>
                <td><input type="checkbox" checked={selectedIds.includes(result.id)} disabled={!eligible || promoting} onChange={() => toggleSelected(result.id)} /></td>
                <td><strong>{index + 1}</strong></td>
                <td>{result.name}</td>
                <td>{result.usercode}</td>
                <td>{result.category}</td>
                <td>{result.sessionStage}</td>
                <td>{result.currentStage}</td>
                <td>{result.paymentStatus || 'unpaid'}</td>
                <td><strong>{result.score}/{result.maxScore}</strong></td>
                <td>{result.percentage}%</td>
                <td>{formatTime(result.timeUsedSeconds)}</td>
                <td>{formatSubmitted(result.submittedAt)}</td>
                <td>{result.attemptCount || 1}{(result.hiddenAttemptCount || 0) > 0 && <div className="small muted">{result.hiddenAttemptCount} hidden duplicate(s)</div>}</td>
                <td>{result.status === 'completed' ? 'Completed' : 'Archived / promoted'}{!eligible && <div className="small muted">Not eligible for {targetStage}</div>}{eligible && result.status !== 'completed' && <div className="small muted">Can be re-promoted to Live Finals</div>}</td>
                <td>{result.proctoringSummary?.riskLevel || 'LOW'} ({result.proctoringSummary?.total || 0})</td>
              </tr>;
            })}</tbody>
          </table></div>}
        </section>
      </div>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return <div className="card card-pad" style={{ boxShadow: 'none', textAlign: 'center' }}><div className="muted small">{title}</div><h2>{value}</h2></div>;
}
