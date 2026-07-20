'use client';

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { DEFAULT_CATEGORIES } from '@/lib/constants';

type Result = {
  id: string;
  name: string;
  usercode: string;
  category: string;
  status?: string;
  score: number;
  maxScore: number;
  totalQuestions: number;
  percentage: number;
  timeUsedSeconds: number;
  submittedAt: string;
  proctoringSummary?: { riskLevel?: string; total?: number };
};

function formatTime(seconds: number) {
  const m = Math.floor((seconds || 0) / 60);
  const s = Math.floor((seconds || 0) % 60);
  return `${m}m ${s}s`;
}

function rankResults(results: Result[], category: string) {
  const filtered = category === 'All' ? [...results] : results.filter(result => result.category === category);
  return filtered.sort((a, b) => b.score - a.score || a.timeUsedSeconds - b.timeUsedSeconds || a.name.localeCompare(b.name));
}

export default function AdminResultsPage() {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('All');
  const [results, setResults] = useState<Result[]>([]);

  const rankedResults = useMemo(() => rankResults(results, category), [results, category]);

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

  async function loadResults() {
    setLoading(true);
    setMessage('Loading ranked results...');
    const json = await fetch('/api/admin/results').then(res => res.json()).catch(() => ({}));
    setLoading(false);
    if (json.error) { setError(json.error); setMessage(''); return; }
    setResults(json.results || []);
    setMessage('');
  }

  function exportExcel() {
    const rows = rankedResults.map((result, index) => ({
      Rank: index + 1,
      Name: result.name,
      Usercode: result.usercode,
      Category: result.category,
      Score: result.score,
      'Max Score': result.maxScore,
      Percentage: `${result.percentage}%`,
      'Time Used': formatTime(result.timeUsedSeconds),
      'Time Used Seconds': result.timeUsedSeconds,
      'Submitted At': result.submittedAt,
      'Proctoring Risk': result.proctoringSummary?.riskLevel || 'LOW',
      'Proctoring Events': result.proctoringSummary?.total || 0
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Ranked Results');
    XLSX.writeFile(workbook, `mezzopedia-ranked-results-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'all'}.xlsx`);
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
            <p className="muted">The default order is always: highest score first. If scores are tied, the candidate who used the least time comes first. Category filtering keeps the same ranking rule.</p>
          </div>

          <div className="grid grid-3 no-print">
            <label>
              <span className="label">Filter by Category</span>
              <select className="select" value={category} onChange={e => setCategory(e.target.value)}>
                {['All', ...DEFAULT_CATEGORIES].map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-3">
            <Metric title="Total Results" value={String(results.length)} />
            <Metric title="Showing" value={String(rankedResults.length)} />
            <Metric title="Order" value="Score ↓ / Time ↑" />
          </div>
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          {loading && <div className="alert alert-info">Loading results...</div>}
          {!loading && !rankedResults.length && <div className="alert alert-info">No results found for this category.</div>}
          {!!rankedResults.length && <div className="table-wrap"><table>
            <thead><tr><th>Rank</th><th>Name</th><th>Code</th><th>Category</th><th>Score</th><th>%</th><th>Time Used</th><th>Submitted</th><th>Risk</th></tr></thead>
            <tbody>{rankedResults.map((result, index) => <tr key={result.id}>
              <td><strong>{index + 1}</strong></td>
              <td>{result.name}</td>
              <td>{result.usercode}</td>
              <td>{result.category}</td>
              <td><strong>{result.score}/{result.maxScore}</strong></td>
              <td>{result.percentage}%</td>
              <td>{formatTime(result.timeUsedSeconds)}</td>
              <td>{result.submittedAt ? new Date(result.submittedAt).toLocaleString() : ''}</td>
              <td>{result.proctoringSummary?.riskLevel || 'LOW'} ({result.proctoringSummary?.total || 0})</td>
            </tr>)}</tbody>
          </table></div>}
        </section>
      </div>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return <div className="card card-pad" style={{ boxShadow: 'none', textAlign: 'center' }}><div className="muted small">{title}</div><h2>{value}</h2></div>;
}
