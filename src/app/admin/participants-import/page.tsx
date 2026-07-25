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
  if (!raw) return '';
  const exact = DEFAULT_CATEGORIES.find(category => category.toLowerCase() === raw);
  if (exact) return exact;
  if (raw === 'adult' || raw === 'adults') return 'Adults';
  // Do not accept the broad registration-app category "student" here.
  // The contest app needs the exact class/category, such as Primary 6 or JHS 1.
  return '';
}

function fileSafe(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'file';
}

function codeKey(value: string) {
  return value.trim().toLowerCase();
}

export default function ParticipantsImportPage() {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<ParticipantImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [importMode, setImportMode] = useState<'mergeUpdate' | 'addOnly'>('mergeUpdate');
  const [existingCodes, setExistingCodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) throw new Error('Admin login required.');
      setReady(true);
      return fetch('/api/admin/participants').then(r => r.json()).then(json => {
        const codes = new Set<string>((json.participants || []).map((item: any) => codeKey(item.usercode || '')));
        setExistingCodes(codes);
      });
    }).catch(err => setError(err.message || 'Could not verify admin session.'));
  }, []);

  function parseSheet(workbook: XLSX.WorkBook) {
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const parsed = rawRows.map(row => ({
      category: normalizeCategory(get(row, ['category', 'class', 'class category', 'contest category', 'level'])),
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
      const existingCount = parsed.filter(row => existingCodes.has(codeKey(row.usercode))).length;
      const duplicateInFileCount = duplicateCodes(parsed).length;
      const invalidCategoryCount = parsed.filter(row => row.usercode && !row.category).length;
      setMessage(`Loaded ${parsed.length} row(s) from ${file.name}. ${existingCount} row(s) match existing codes. ${duplicateInFileCount} duplicate code(s) found inside this file. ${invalidCategoryCount} row(s) have invalid/missing contest category.`);
    } catch {
      setError('Could not read the Excel/CSV file. Use .xlsx, .xls or .csv with headings.');
    }
  }

  function duplicateCodes(list: ParticipantImportRow[]) {
    const counts = new Map<string, number>();
    for (const row of list) {
      const key = codeKey(row.usercode);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key);
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
    if (!validRows.length) { setError('No valid rows found. Each row needs exact contest category, name, usercode and password. Do not use the broad category "student".'); return; }
    const invalidCount = rows.length - validRows.length;
    if (invalidCount > 0 && !confirm(`${invalidCount} row(s) are missing required fields or exact contest category and will be skipped. Continue?`)) return;

    const duplicatesInsideFile = duplicateCodes(validRows);
    if (duplicatesInsideFile.length) {
      setError(`Duplicate usercode(s) found inside this file: ${duplicatesInsideFile.join(', ')}. Fix the file so every usercode appears only once.`);
      return;
    }

    const existingCount = validRows.filter(row => existingCodes.has(codeKey(row.usercode))).length;
    const confirmText = importMode === 'mergeUpdate'
      ? `Merge & Update will add new participants and update ${existingCount} existing record(s). It will not delete saved participants and will not downgrade an existing payment status. Paid remains paid. Continue?`
      : `Add New Only will skip ${existingCount} existing record(s) and add only new codes. Continue?`;
    if (!confirm(confirmText)) return;

    setLoading(true);
    setError('');
    const res = await fetch('/api/admin/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participants: validRows, importMode })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(json.error || 'Import failed.'); return; }
    setRows([]);
    setFileName('');
    setMessage(`Import complete. Inserted: ${json.inserted || 0}. Updated: ${json.updated || 0}. Payment upgraded: ${json.paymentUpgraded || 0}. Payment protected from downgrade: ${json.preservedPaymentStatus || 0}. Skipped existing: ${json.skippedExisting || 0}. Saved data was not deleted.`);
    fetch('/api/admin/participants').then(r => r.json()).then(data => {
      setExistingCodes(new Set<string>((data.participants || []).map((item: any) => codeKey(item.usercode || ''))));
    }).catch(() => null);
  }

  if (error && !ready) {
    return <main className="math-bg centered"><div className="card card-pad"><div className="alert alert-error">{error}</div><a className="btn btn-primary" href="/admin">Back to Admin</a></div></main>;
  }

  const existingCount = rows.filter(row => existingCodes.has(codeKey(row.usercode))).length;
  const validCount = rows.filter(row => row.category && row.name && row.usercode && row.password).length;
  const invalidCategoryCount = rows.filter(row => row.usercode && !row.category).length;

  return (
    <main className="math-bg" style={{ paddingBottom: 40 }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Participant Excel Import</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin">Back to Admin</a>
            <a className="btn btn-primary" href="/admin/participants">Participant Manager</a>
            <a className="btn btn-primary" href="/admin/category-fix">Category Fix</a>
            <button className="btn btn-light" onClick={downloadTemplate}>Download Excel Template</button>
          </div>
        </nav>

        {message && <div className="alert alert-success">{message}</div>}
        {error && ready && <div className="alert alert-error">{error}</div>}

        <section className="card card-pad grid">
          <div>
            <span className="badge">Bulk participant upload</span>
            <h1 style={{ marginTop: 12 }}>Upload participants with Excel or CSV</h1>
            <p className="muted">Use headings like category, name, usercode, password, payment_status and stage. Category must be the exact contest category: {DEFAULT_CATEGORIES.join(', ')}. Do not use the broad registration category student.</p>
          </div>

          <div className="alert alert-info">
            <strong>Merge & Update is safe:</strong> it adds new codes and updates matching existing codes. It does not delete previously saved participants, and payment status is protected from going backwards. Paid remains paid; pending will not be changed back to unpaid.
          </div>

          <div className="grid grid-2">
            <label>
              <span className="label">Import Mode</span>
              <select className="select" value={importMode} onChange={e => setImportMode(e.target.value as 'mergeUpdate' | 'addOnly')}>
                <option value="mergeUpdate">Merge & Update existing records</option>
                <option value="addOnly">Add new only, skip existing records</option>
              </select>
            </label>
            <label>
              <span className="label">Excel/CSV File</span>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
            </label>
          </div>
          {fileName && <p className="small muted">Selected file: {fileName}</p>}

          <div className="grid grid-4">
            <Metric title="Rows Loaded" value={String(rows.length)} />
            <Metric title="Valid Rows" value={String(validCount)} />
            <Metric title="Invalid Categories" value={String(invalidCategoryCount)} />
            <Metric title="Existing Codes" value={String(existingCount)} />
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
                const exists = existingCodes.has(codeKey(row.usercode));
                return <tr key={`${row.usercode}-${index}`}><td>{index + 1}</td><td>{row.category || 'Invalid category'}</td><td>{row.name}</td><td><strong>{row.usercode}</strong></td><td>{row.password ? 'Provided' : ''}</td><td>{row.paymentStatus}</td><td>{row.contestStage}</td><td>{valid ? (exists ? (importMode === 'mergeUpdate' ? 'Will update existing, without downgrading payment' : 'Will skip existing') : 'Will add new') : 'Missing field/exact category'}</td></tr>;
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
