'use client';

import { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import { DEFAULT_CATEGORIES } from '@/lib/constants';

type StageSummary = { score: number; maxScore: number; percentage: number; timeUsedSeconds: number; submittedAt: string; status: string };
type Finalist = {
  rank: number;
  participantId: string;
  name: string;
  usercode: string;
  class: string;
  category: string;
  location: string;
  region: string;
  school: string;
  paymentStatus: string;
  currentStage: string;
  stageScores: Record<string, StageSummary | null>;
  averageScore: number;
  averagePercentage: number;
  averageTimeSeconds: number;
};

function formatTime(seconds: number) {
  const m = Math.floor((seconds || 0) / 60);
  const s = Math.floor((seconds || 0) % 60);
  return `${m}m ${s}s`;
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function stageScore(row: Finalist, stage: string) {
  const result = row.stageScores?.[stage];
  return result ? `${result.score}/${result.maxScore} (${result.percentage}%)` : '';
}

function fileSafe(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all';
}

export default function LiveFinalistsPage() {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Finalist[]>([]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => !q || [row.name, row.usercode, row.class, row.location, row.region, row.school].some(value => String(value || '').toLowerCase().includes(q)));
  }, [rows, search]);

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) throw new Error('Admin login required.');
      setReady(true);
      return loadFinalists();
    }).catch(err => {
      setError(err.message || 'Could not verify admin session.');
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFinalists(nextCategory = category) {
    setLoading(true);
    setError('');
    setMessage('Loading Live Finals list...');
    const params = new URLSearchParams({ category: nextCategory });
    const json = await fetch(`/api/admin/live-finalists?${params.toString()}`, { cache: 'no-store' }).then(res => res.json()).catch(() => ({}));
    setLoading(false);
    if (json.error) { setError(json.error); setMessage(''); return; }
    setRows(json.rows || []);
    setMessage('');
  }

  function onCategoryChange(value: string) {
    setCategory(value);
    loadFinalists(value);
  }

  function exportCsv() {
    const headers = ['Rank', 'Name', 'Code', 'Class', 'Location', 'Region', 'School', 'Category', 'Payment', 'Stage 1', 'Stage 2', 'Stage 3', 'Average %', 'Average Time'];
    const body = filteredRows.map(row => [
      row.rank,
      row.name,
      row.usercode,
      row.class,
      row.location,
      row.region,
      row.school,
      row.category,
      row.paymentStatus,
      stageScore(row, 'Stage 1'),
      stageScore(row, 'Stage 2'),
      stageScore(row, 'Stage 3'),
      `${row.averagePercentage}%`,
      formatTime(row.averageTimeSeconds)
    ].map(csvEscape).join(','));
    const csv = [headers.map(csvEscape).join(','), ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mezzopedia-live-finalists-${fileSafe(category)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    if (!filteredRows.length) return;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 8;
    const lineHeight = 3.8;
    const rowMinHeight = 8.5;
    const columns = [
      { label: '#', width: 7, value: (_row: Finalist, index: number) => String(index + 1) },
      { label: 'Name', width: 42, value: (row: Finalist) => row.name },
      { label: 'Code', width: 20, value: (row: Finalist) => row.usercode },
      { label: 'Class', width: 20, value: (row: Finalist) => row.class || row.category },
      { label: 'Location', width: 26, value: (row: Finalist) => row.location },
      { label: 'Region', width: 22, value: (row: Finalist) => row.region },
      { label: 'School', width: 37, value: (row: Finalist) => row.school },
      { label: 'Stage 1', width: 22, value: (row: Finalist) => stageScore(row, 'Stage 1') },
      { label: 'Stage 2', width: 22, value: (row: Finalist) => stageScore(row, 'Stage 2') },
      { label: 'Stage 3', width: 22, value: (row: Finalist) => stageScore(row, 'Stage 3') },
      { label: 'Average', width: 23, value: (row: Finalist) => `${row.averagePercentage}% / ${formatTime(row.averageTimeSeconds)}` }
    ];

    const generatedAt = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    let pageNumber = 1;
    let y = 0;

    const addTitleAndHeader = () => {
      y = 11;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Mezzopedia Live Finalists List', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      y += 6;
      doc.text(`Category: ${category}    Showing: ${filteredRows.length} finalist(s)    Generated: ${generatedAt}`, margin, y);
      doc.text(`Page ${pageNumber}`, pageWidth - margin - 18, y);
      y += 7;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      let x = margin;
      for (const column of columns) {
        doc.rect(x, y, column.width, rowMinHeight);
        doc.text(column.label, x + 1, y + 5.5);
        x += column.width;
      }
      y += rowMinHeight;
      doc.setFont('helvetica', 'normal');
    };

    const addWrappedCellText = (text: string, x: number, yTop: number, width: number, maxLines = 3) => {
      const clean = String(text || '').replace(/\s+/g, ' ').trim();
      const lines = doc.splitTextToSize(clean || ' ', Math.max(4, width - 2)).slice(0, maxLines);
      doc.text(lines, x + 1, yTop + 4);
      return lines.length;
    };

    addTitleAndHeader();

    filteredRows.forEach((row, index) => {
      doc.setFontSize(7);
      const values = columns.map(column => String(column.value(row, index) || ''));
      const lineCounts = values.map((value, columnIndex) => doc.splitTextToSize(value.replace(/\s+/g, ' ').trim() || ' ', Math.max(4, columns[columnIndex].width - 2)).slice(0, 3).length || 1);
      const rowHeight = Math.max(rowMinHeight, Math.max(...lineCounts) * lineHeight + 3.5);

      if (y + rowHeight > pageHeight - 10) {
        doc.addPage();
        pageNumber += 1;
        addTitleAndHeader();
      }

      let x = margin;
      columns.forEach((column, columnIndex) => {
        doc.rect(x, y, column.width, rowHeight);
        addWrappedCellText(values[columnIndex], x, y, column.width, columnIndex === 1 || columnIndex === 6 ? 3 : 2);
        x += column.width;
      });
      y += rowHeight;
    });

    doc.setFontSize(8);
    doc.text('This document contains candidates promoted to the Live Finals stage.', margin, pageHeight - 5);
    doc.save(`mezzopedia-live-finalists-${fileSafe(category)}.pdf`);
  }

  if (error && !ready && !loading) {
    return <main className="math-bg centered"><div className="card card-pad"><div className="alert alert-error">{error}</div><a className="btn btn-primary" href="/admin">Back to Admin</a></div></main>;
  }

  return (
    <main className="math-bg" style={{ paddingBottom: 40 }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Live Finals List</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin">Back to Admin</a>
            <a className="btn btn-light" href="/admin/results">Results</a>
            <button className="btn btn-light" onClick={() => loadFinalists()} disabled={loading}>Refresh</button>
            <button className="btn btn-light" onClick={exportPdf} disabled={!filteredRows.length}>Export PDF</button>
            <button className="btn btn-primary" onClick={exportCsv} disabled={!filteredRows.length}>Export CSV</button>
          </div>
        </nav>

        {message && <div className="alert alert-info">{message}</div>}
        {error && ready && <div className="alert alert-error">{error}</div>}

        <section className="card card-pad grid">
          <div>
            <span className="badge">Promoted to Live Finals</span>
            <h1 style={{ marginTop: 12 }}>Finalists selected for the live stage</h1>
            <p className="muted">This page lists candidates whose current assigned stage is Live Finals. Promote candidates from the Results page by selecting their Stage 3 result and choosing Live Finals as the target stage.</p>
            <div className="alert alert-info">The Class column uses the saved participant class if available; otherwise it uses the contest category. Location, Region and School will show once those fields exist in the participant record.</div>
          </div>

          <div className="grid grid-3 no-print">
            <label><span className="label">Category</span><select className="select" value={category} onChange={e => onCategoryChange(e.target.value)}>{['All', ...DEFAULT_CATEGORIES].map(item => <option key={item}>{item}</option>)}</select></label>
            <label><span className="label">Search</span><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, code, school, region or location" /></label>
          </div>

          <div className="grid grid-4">
            <Metric title="Finalists" value={String(rows.length)} />
            <Metric title="Showing" value={String(filteredRows.length)} />
            <Metric title="Category" value={category} />
            <Metric title="Stage" value="Live Finals" />
          </div>
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          {loading && <div className="alert alert-info">Loading finalists...</div>}
          {!loading && !filteredRows.length && <div className="alert alert-info">No Live Finals finalist found for this filter.</div>}
          {!!filteredRows.length && <div className="table-wrap"><table>
            <thead><tr><th>#</th><th>Name</th><th>Code</th><th>Class</th><th>Location</th><th>Region</th><th>School</th><th>Stage 1</th><th>Stage 2</th><th>Stage 3</th><th>Average</th></tr></thead>
            <tbody>{filteredRows.map((row, index) => <tr key={row.participantId}>
              <td><strong>{index + 1}</strong></td>
              <td>{row.name}</td>
              <td>{row.usercode}</td>
              <td>{row.class || row.category}</td>
              <td>{row.location}</td>
              <td>{row.region}</td>
              <td>{row.school}</td>
              <td>{stageScore(row, 'Stage 1')}</td>
              <td>{stageScore(row, 'Stage 2')}</td>
              <td>{stageScore(row, 'Stage 3')}</td>
              <td>{row.averagePercentage}%<div className="small muted">{formatTime(row.averageTimeSeconds)}</div></td>
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
