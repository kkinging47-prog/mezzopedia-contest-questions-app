'use client';

import { ChangeEvent, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { CONTEST_STAGES, DEFAULT_CATEGORIES, FINAL_TRIAL_STAGE, PAYMENT_STATUSES } from '@/lib/constants';

type ParticipantImportRow = {
  category: string;
  name: string;
  usercode: string;
  password: string;
  paymentStatus: string;
  contestStage: string;
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

function normalizePayment(value: string) {
  const raw = value.trim().toLowerCase();
  if (raw === 'paid') return 'paid';
  if (raw === 'pending') return 'pending';
  return 'unpaid';
}

function normalizeStage(value: string) {
  const raw = value.trim().toLowerCase();
  return CONTEST_STAGES.find(stage => stage.toLowerCase() === raw) || FINAL_TRIAL_STAGE;
}

function normalizeCategory(value: string) {
  const raw = value.trim().toLowerCase();
  return DEFAULT_CATEGORIES.find(category => category.toLowerCase() === raw) || value.trim();
}

function fileSafe(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'file';
}

export default function ParticipantsImportPage() {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<ParticipantImportRow[]>([]);
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) throw new Error('Admin login required.');
      setReady(true);
    }).catch(err => setError(err.message || 'Could not verify admin session.'));
  }, []);

  function parseSheet(workbook: XLSX.WorkBook) {
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const parsed = rawRows.map(row => ({
      category: normalizeCategory(get(row, ['category', 'class', 'class category', 'level'])),
      name: get(row, ['name', 'student name', 'participant name', 'candidate name', 'full name']),
      usercode: get(row, ['usercode', 'user code', 'code', 'registration code', 'unique code']),
      password: get(row, ['password', 'passcode', 'pin']),
      paymentStatus: normalizePayment(get(row, ['payment status', 'payment_status', 'payment', 'status'])),
      contestStage: normalizeStage(get(row, ['stage', 'contest stage', 'contest_stage', 'phase']))
    })).filter(row => row.category || row.name || row.usercode || row.password);
    return parsed;
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setRows([]);
    setError('');
    setMessage('');
    setFileName(file?.name || '');
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const parsed = parseSheet(workbook);
      setRows(parsed);
      setMessage(`Loaded ${parsed.length} row(s) from ${file.name}. Review the preview, then click Import Participants.`);
    } catch {
      setError('Could not read the Excel/CSV file. Use .xlsx, .xls or .csv with headings.');
    }
  }

  function downloadTemplate() {
    const template = DEFAULT_CATEGORIES.map(category => ({
      category,
      name: '',
      usercode: '',
      password: '',
      payment_status: 'unpaid',
      stage: FINAL_TRIAL_STAGE
    }));
    const sheet = XLSX.utils.json_to_sheet(template);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Participants');
    XLSX.writeFile(workbook, `mezzopedia-participant-import-template-${fileSafe(new Date().toISOString().slice(0, 10))}.xlsx`);
  }

  async function importRows() {
    const validRows = rows.filter(row => row.category && row.name && row.usercode && row.password);
    if (!validRows.length) { setError('No valid rows found. Each row needs category, name, usercode and password.'); return; }
    const invalidCount = rows.length - validRows.length;
    if (invalidCount > 0 && !confirm(`${invalidCount} row(s) are missing required fields and will be skipped. Continue?`)) return;

    setLoading(true);
    setError('');
    const res = await fetch('/api/admin/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participants: validRows })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(json.error || 'Import failed.'); return; }
    setRows([]);
    setFileName('');
    setMessage(`Imported ${json.imported} participant(s) successfully.`);
  }

  if (error && !ready) {
    return <main className="math-bg centered"><div className="card card-pad"><div className="alert alert-error">{error}</div><a className="btn btn-primary" href="/admin">Back to Admin</a></div></main>;
  }

  return (
    <main className="math-bg" style={{ paddingBottom: 40 }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Participant Excel Import</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin">Back to Admin</a>
            <button className="btn btn-light" onClick={downloadTemplate}>Download Excel Template</button>
          </div>
        </nav>

        {message && <div className="alert alert-success">{message}</div>}
        {error && ready && <div className="alert alert-error">{error}</div>}

        <section className="card card-pad grid">
          <div>
            <span className="badge">Bulk participant upload</span>
            <h1 style={{ marginTop: 12 }}>Upload participants with Excel or CSV</h1>
            <p className="muted">Use headings like category, name, usercode, password, payment_status and stage. The stage can be Final Trial, Stage 1, Stage 2 or Stage 3.</p>
          </div>

          <div className="alert alert-info">
            Unpaid or pending participants can enter <strong>Final Trial</strong>, but they will be blocked from Stage 1, Stage 2 and Stage 3 until payment_status is <strong>paid</strong>.
          </div>

          <label>
            <span className="label">Excel/CSV File</span>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
          </label>
          {fileName && <p className="small muted">Selected file: {fileName}</p>}

          <div className="grid grid-3">
            <Metric title="Rows Loaded" value={String(rows.length)} />
            <Metric title="Valid Rows" value={String(rows.filter(row => row.category && row.name && row.usercode && row.password).length)} />
            <Metric title="Default Stage" value={FINAL_TRIAL_STAGE} />
          </div>

          <div className="flex wrap no-print">
            <button className="btn btn-primary" onClick={importRows} disabled={loading || !rows.length}>{loading ? 'Importing...' : 'Import Participants'}</button>
            <button className="btn btn-light" onClick={() => { setRows([]); setFileName(''); setError(''); setMessage(''); }}>Clear Preview</button>
          </div>
        </section>

        {!!rows.length && <section className="card card-pad" style={{ marginTop: 18 }}>
          <h2>Preview before import</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Category</th><th>Name</th><th>Usercode</th><th>Password</th><th>Payment</th><th>Stage</th><th>Status</th></tr></thead>
              <tbody>{rows.map((row, index) => {
                const valid = row.category && row.name && row.usercode && row.password;
                return <tr key={`${row.usercode}-${index}`}><td>{index + 1}</td><td>{row.category}</td><td>{row.name}</td><td><strong>{row.usercode}</strong></td><td>{row.password ? 'Provided' : ''}</td><td>{row.paymentStatus}</td><td>{row.contestStage}</td><td>{valid ? 'Ready' : 'Missing required field'}</td></tr>;
              })}</tbody>
            </table>
          </div>
        </section>}
      </div>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return <div className="card card-pad" style={{ boxShadow: 'none', textAlign: 'center' }}><div className="muted small">{title}</div><h2>{value}</h2></div>;
}
