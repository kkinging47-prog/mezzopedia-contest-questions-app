'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { DEFAULT_CATEGORIES } from '@/lib/constants';

type InvalidParticipant = {
  id: string;
  name: string;
  usercode: string;
  category: string;
  payment_status: string;
  contest_stage: string;
};

type CategoryFixRow = {
  rowNumber: number;
  usercode: string;
  category: string;
  rawCategory: string;
};

type FixResult = {
  requested?: number;
  updated: number;
  skippedNotFound?: number;
  skippedMultiple?: number;
  notFound?: string[];
  multipleMatches?: string[];
  message?: string;
};

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function get(row: Record<string, unknown>, keys: string[]) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), value]));
  for (const key of keys) {
    const found = normalized.get(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (found !== undefined) return clean(found);
  }
  return '';
}

function normalizeCategory(value: unknown) {
  const raw = clean(value);
  if (!raw) return '';
  return DEFAULT_CATEGORIES.find(category => category.toLowerCase() === raw.toLowerCase()) || '';
}

function codeKey(value: string) {
  return value.trim().toLowerCase();
}

function duplicateCodes(rows: CategoryFixRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = codeKey(row.usercode);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([code]) => code);
}

function fileSafe(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'file';
}

export default function CategoryFixPage() {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [invalidRows, setInvalidRows] = useState<InvalidParticipant[]>([]);
  const [rows, setRows] = useState<CategoryFixRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [bulkCategory, setBulkCategory] = useState(DEFAULT_CATEGORIES[0]);
  const [result, setResult] = useState<FixResult | null>(null);

  const validRows = useMemo(() => rows.filter(row => row.usercode && row.category), [rows]);
  const invalidUploadRows = useMemo(() => rows.filter(row => row.usercode && !row.category), [rows]);
  const duplicates = useMemo(() => duplicateCodes(validRows), [validRows]);

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) throw new Error('Admin login required.');
      setReady(true);
      return loadInvalidRows();
    }).catch(err => {
      setError(err.message || 'Could not verify admin session.');
      setLoading(false);
    });
  }, []);

  async function loadInvalidRows() {
    setLoading(true);
    setError('');
    const json = await fetch('/api/admin/participants/category-fix').then(res => res.json()).catch(() => ({}));
    setLoading(false);
    if (json.error) { setError(json.error); return; }
    setInvalidRows(json.invalidRows || []);
  }

  function downloadTemplate() {
    const template = [
      { usercode: 'MNMC00001', category: 'Primary 5' },
      { usercode: 'MNMC00002', category: 'Primary 6' },
      { usercode: 'MNMC00003', category: 'JHS 1' },
      { usercode: 'MNMC00004', category: 'JHS 2' },
      { usercode: 'MNMC00005', category: 'JHS 3' },
      { usercode: 'MNMC00006', category: 'SHS' },
      { usercode: 'MNMC00007', category: 'Adults' }
    ];
    const sheet = XLSX.utils.json_to_sheet(template);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Category Fix');
    XLSX.writeFile(workbook, `mezzopedia-category-fix-template-${fileSafe(new Date().toISOString().slice(0, 10))}.xlsx`);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setRows([]);
    setFileName(file?.name || '');
    setError('');
    setMessage('');
    setResult(null);
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const parsed = rawRows.map((row, index) => {
        const rawCategory = get(row, ['category', 'class', 'class category', 'contest category', 'level']);
        return {
          rowNumber: index + 2,
          usercode: get(row, ['usercode', 'user code', 'unique_code', 'unique code', 'code', 'registration code', 'reg code']),
          category: normalizeCategory(rawCategory),
          rawCategory
        };
      }).filter(row => row.usercode || row.rawCategory);
      setRows(parsed);
      setMessage(`Loaded ${parsed.length} row(s). ${parsed.filter(row => row.usercode && row.category).length} row(s) are ready to update.`);
    } catch {
      setError('Could not read the Excel/CSV file. Use headings: usercode and category.');
    } finally {
      event.currentTarget.value = '';
    }
  }

  async function applyCategoryFile() {
    if (!validRows.length) { setError('No valid rows found. Use columns: usercode and category.'); return; }
    if (duplicates.length) { setError(`Duplicate usercode(s) found in the file: ${duplicates.join(', ')}.`); return; }
    if (invalidUploadRows.length && !confirm(`${invalidUploadRows.length} row(s) have an invalid category and will be skipped. Continue?`)) return;
    if (!confirm(`Update categories for ${validRows.length} participant code(s)? This will not change payment, password, stage or results.`)) return;

    setFixing(true);
    setError('');
    setMessage('Updating participant categories...');
    const res = await fetch('/api/admin/participants/category-fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateByCodes', updates: validRows.map(({ usercode, category }) => ({ usercode, category })) })
    });
    const json = await res.json().catch(() => ({}));
    setFixing(false);
    if (!res.ok) { setError(json.error || 'Category fix failed.'); setMessage(''); return; }
    setResult(json);
    setMessage(`Category fix complete. Updated ${json.updated || 0} participant(s).`);
    setRows([]);
    setFileName('');
    await loadInvalidRows();
  }

  async function updateAllInvalidToOneCategory() {
    if (!invalidRows.length) { setMessage('No invalid categories to fix.'); return; }
    if (!confirm(`This will change ALL ${invalidRows.length} invalid categories, such as student/adult, to ${bulkCategory}. Use this only if they all belong to ${bulkCategory}. Continue?`)) return;

    setFixing(true);
    setError('');
    setMessage(`Updating all invalid categories to ${bulkCategory}...`);
    const res = await fetch('/api/admin/participants/category-fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bulkUpdateInvalid', targetCategory: bulkCategory })
    });
    const json = await res.json().catch(() => ({}));
    setFixing(false);
    if (!res.ok) { setError(json.error || 'Bulk category fix failed.'); setMessage(''); return; }
    setResult(json);
    setMessage(`Updated ${json.updated || 0} invalid participant categories to ${bulkCategory}.`);
    await loadInvalidRows();
  }

  if (error && !ready && !loading) {
    return <main className="math-bg centered"><div className="card card-pad"><div className="alert alert-error">{error}</div><a className="btn btn-primary" href="/admin">Back to Admin</a></div></main>;
  }

  return (
    <main className="math-bg" style={{ paddingBottom: 50 }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Participant Category Fix</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin">Back to Admin</a>
            <a className="btn btn-primary" href="/admin/participants">Participants</a>
            <button className="btn btn-light" onClick={downloadTemplate}>Download Template</button>
            <button className="btn btn-light" onClick={loadInvalidRows} disabled={loading}>Refresh</button>
          </div>
        </nav>

        {message && <div className="alert alert-success">{message}</div>}
        {error && ready && <div className="alert alert-error">{error}</div>}

        <section className="card card-pad">
          <span className="badge">Fix student/adult category problem</span>
          <h1 style={{ marginTop: 12 }}>Update participant categories by usercode</h1>
          <p className="muted">Upload a simple Excel/CSV with <strong>usercode</strong> and the correct contest <strong>category</strong>. This only updates category. It does not touch name, payment status, password, assigned stage, results or certificates.</p>

          <div className="alert alert-info">
            Valid categories are: <strong>{DEFAULT_CATEGORIES.join(', ')}</strong>. The registration app category <strong>student</strong> is not a contest category, so it must be replaced with the correct class/category.
          </div>

          <div className="grid grid-4" style={{ marginTop: 18 }}>
            <Metric title="Invalid Categories" value={String(invalidRows.length)} />
            <Metric title="Rows Loaded" value={String(rows.length)} />
            <Metric title="Ready Updates" value={String(validRows.length)} />
            <Metric title="Invalid Upload Rows" value={String(invalidUploadRows.length)} />
          </div>
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          <h2>Recommended: upload usercode + correct category</h2>
          <div className="grid grid-2 no-print">
            <label><span className="label">Excel/CSV File</span><input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} /></label>
            <button className="btn btn-primary" style={{ alignSelf: 'end' }} onClick={applyCategoryFile} disabled={fixing || !validRows.length}>{fixing ? 'Updating...' : 'Apply Category Fix File'}</button>
          </div>
          {fileName && <p className="small muted">Selected file: {fileName}</p>}
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          <h2>Quick fix for one group only</h2>
          <p className="muted">Use this only when all invalid records showing as student/adult belong to the same contest category.</p>
          <div className="grid grid-2 no-print">
            <label><span className="label">Set all invalid categories to</span><select className="select" value={bulkCategory} onChange={e => setBulkCategory(e.target.value)}>{DEFAULT_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
            <button className="btn btn-danger" style={{ alignSelf: 'end' }} onClick={updateAllInvalidToOneCategory} disabled={fixing || !invalidRows.length}>Change All Invalid to Selected Category</button>
          </div>
        </section>

        {result && <section className="card card-pad" style={{ marginTop: 18 }}>
          <h2>Last fix result</h2>
          <div className="grid grid-4">
            <Metric title="Requested" value={String(result.requested ?? result.updated ?? 0)} />
            <Metric title="Updated" value={String(result.updated || 0)} />
            <Metric title="Not Found" value={String(result.skippedNotFound || 0)} />
            <Metric title="Duplicate Codes" value={String(result.skippedMultiple || 0)} />
          </div>
          {!!result.notFound?.length && <p className="small muted">Not found: {result.notFound.join(', ')}</p>}
          {!!result.multipleMatches?.length && <p className="small muted">Skipped duplicate code matches: {result.multipleMatches.join(', ')}</p>}
        </section>}

        {!!rows.length && <section className="card card-pad" style={{ marginTop: 18 }}>
          <h2>Preview category fix file</h2>
          {duplicates.length > 0 && <div className="alert alert-error">Duplicate codes in file: {duplicates.join(', ')}</div>}
          <div className="table-wrap"><table>
            <thead><tr><th>Row</th><th>Usercode</th><th>Category</th><th>Status</th></tr></thead>
            <tbody>{rows.slice(0, 500).map(row => <tr key={`${row.rowNumber}-${row.usercode}`}><td>{row.rowNumber}</td><td><strong>{row.usercode}</strong></td><td>{row.category || row.rawCategory}</td><td>{row.usercode && row.category ? 'Ready' : 'Invalid category/code'}</td></tr>)}</tbody>
          </table></div>
        </section>}

        {!!invalidRows.length && <section className="card card-pad" style={{ marginTop: 18 }}>
          <h2>Participants still showing invalid category</h2>
          <p className="muted">These are the records currently showing category values like student/adult instead of the real contest category.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Usercode</th><th>Current Category</th><th>Payment</th><th>Stage</th></tr></thead>
            <tbody>{invalidRows.map(row => <tr key={row.id}><td>{row.name}</td><td><strong>{row.usercode}</strong></td><td>{row.category}</td><td>{row.payment_status}</td><td>{row.contest_stage}</td></tr>)}</tbody>
          </table></div>
        </section>}
      </div>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return <div className="card card-pad" style={{ boxShadow: 'none', textAlign: 'center' }}><div className="muted small">{title}</div><h2>{value}</h2></div>;
}
