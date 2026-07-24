'use client';

import { useEffect, useState } from 'react';

type SyncPreview = {
  matched: number;
  statusChanges: number;
  nameChanges: number;
  duplicateContestCodes: number;
  unmatchedCount: number;
  unmatched: Array<{ name: string; uniqueCode: string; paymentStatus: string; category: string; stage: string }>;
};

type SyncStatus = {
  configured: boolean;
  message?: string;
  registrationSummary?: { total: number; paid: number; pending: number; unpaid: number };
  contestSummary?: { total: number };
  preview?: SyncPreview;
};

type SyncResult = {
  checked: number;
  matched: number;
  updated: number;
  statusUpdated: number;
  nameUpdated: number;
  passwordUpdated: number;
  skippedUnmatched: number;
  skippedDuplicateContestCodes: number;
  unmatched: Array<{ name: string; uniqueCode: string; paymentStatus: string; category: string; stage: string }>;
  note?: string;
};

export default function PaymentSyncPage() {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [updateNames, setUpdateNames] = useState(true);
  const [updatePasswords, setUpdatePasswords] = useState(false);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) throw new Error('Admin login required.');
      setReady(true);
      return loadStatus();
    }).catch(err => {
      setError(err.message || 'Could not verify admin session.');
      setLoading(false);
    });
  }, []);

  async function loadStatus() {
    setLoading(true);
    setError('');
    setMessage('Checking registration connection...');
    const json = await fetch('/api/admin/payment-sync').then(res => res.json()).catch(() => ({}));
    setLoading(false);
    if (json.error) { setError(json.error); setMessage(''); return; }
    setStatus(json);
    setMessage(json.configured ? 'Registration connection checked.' : (json.message || 'Registration sync is not configured yet.'));
  }

  async function runSync() {
    if (!confirm('Sync payment status from the registration portal into the contest app now?')) return;
    setSyncing(true);
    setError('');
    setMessage('Syncing payment records...');
    setResult(null);
    const res = await fetch('/api/admin/payment-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updateNames, updatePasswords })
    });
    const json = await res.json().catch(() => ({}));
    setSyncing(false);
    if (!res.ok) { setError(json.error || 'Payment sync failed.'); setMessage(''); return; }
    setResult(json);
    setMessage(`Sync complete. Updated ${json.updated || 0} participant(s); payment status changed for ${json.statusUpdated || 0}.`);
    await loadStatus();
  }

  if (error && !ready && !loading) {
    return <main className="math-bg centered"><div className="card card-pad"><div className="alert alert-error">{error}</div><a className="btn btn-primary" href="/admin">Back to Admin</a></div></main>;
  }

  const summary = status?.registrationSummary;
  const preview = status?.preview;

  return (
    <main className="math-bg" style={{ padding: '24px 0 80px' }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Registration Payment Sync</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin/participants">Participants</a>
            <a className="btn btn-light" href="/admin/participants-import">Participants Import</a>
            <a className="btn btn-primary" href="/admin">Back to Admin</a>
          </div>
        </nav>

        <section className="card card-pad">
          <span className="badge">Registration app link</span>
          <h1 style={{ marginTop: 12 }}>Sync paid, pending and unpaid statuses</h1>
          <p className="muted">This page reads the Mezzopedia Registration app and updates matching contest participants by matching <strong>registration unique code</strong> to <strong>contest usercode</strong>. It does not change contest category or assigned stage, so your contest structure remains safe.</p>
          {message && <div className="alert alert-success">{message}</div>}
          {error && ready && <div className="alert alert-error">{error}</div>}

          {!status?.configured && <div className="alert alert-info">
            Add these Vercel environment variables to the contest app, then redeploy: <strong>REGISTRATION_SUPABASE_URL</strong> and <strong>REGISTRATION_SUPABASE_ANON_KEY</strong>. You may use <strong>REGISTRATION_SUPABASE_SERVICE_ROLE_KEY</strong> instead of the anon key if you want a stronger server-only setup.
          </div>}

          <div className="grid grid-4" style={{ marginTop: 18 }}>
            <Metric title="Registration Records" value={summary ? String(summary.total) : '—'} />
            <Metric title="Paid" value={summary ? String(summary.paid) : '—'} />
            <Metric title="Pending" value={summary ? String(summary.pending) : '—'} />
            <Metric title="Unpaid" value={summary ? String(summary.unpaid) : '—'} />
          </div>

          <div className="grid grid-4" style={{ marginTop: 18 }}>
            <Metric title="Contest Participants" value={status?.contestSummary ? String(status.contestSummary.total) : '—'} />
            <Metric title="Matched Codes" value={preview ? String(preview.matched) : '—'} />
            <Metric title="Payment Changes" value={preview ? String(preview.statusChanges) : '—'} />
            <Metric title="Unmatched Codes" value={preview ? String(preview.unmatchedCount) : '—'} />
          </div>
        </section>

        <section className="card card-pad no-print" style={{ marginTop: 18 }}>
          <h2>Sync options</h2>
          <div className="grid grid-2">
            <label className="card card-pad" style={{ boxShadow: 'none' }}><input type="checkbox" checked={updateNames} onChange={e => setUpdateNames(e.target.checked)} /> Update participant names from registration app when different</label>
            <label className="card card-pad" style={{ boxShadow: 'none' }}><input type="checkbox" checked={updatePasswords} onChange={e => setUpdatePasswords(e.target.checked)} /> Also update contest passwords from registration app passwords</label>
          </div>
          <div className="alert alert-info" style={{ marginTop: 14 }}>Recommended: keep password update off unless you want the contest login password to always match the registration portal password.</div>
          <div className="flex wrap" style={{ marginTop: 18 }}>
            <button className="btn btn-light" onClick={loadStatus} disabled={loading || syncing}>{loading ? 'Checking...' : 'Refresh Preview'}</button>
            <button className="btn btn-primary" onClick={runSync} disabled={!status?.configured || syncing}>{syncing ? 'Syncing...' : 'Sync Payment Status Now'}</button>
          </div>
        </section>

        {result && <section className="card card-pad" style={{ marginTop: 18 }}>
          <h2>Last sync result</h2>
          <div className="grid grid-4">
            <Metric title="Checked" value={String(result.checked)} />
            <Metric title="Matched" value={String(result.matched)} />
            <Metric title="Updated" value={String(result.updated)} />
            <Metric title="Payment Updated" value={String(result.statusUpdated)} />
          </div>
          <p className="muted">{result.note}</p>
        </section>}

        {!!preview?.unmatched?.length && <section className="card card-pad" style={{ marginTop: 18 }}>
          <h2>Registration codes not yet in contest participants</h2>
          <p className="muted">These records exist in the registration app, but no matching contest participant usercode was found. Import or create them in Participants first, then sync again.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Registration Code</th><th>Payment</th><th>Registration Category</th><th>Registration Stage</th></tr></thead>
            <tbody>{preview.unmatched.map(row => <tr key={row.uniqueCode}><td>{row.name}</td><td>{row.uniqueCode}</td><td>{row.paymentStatus}</td><td>{row.category}</td><td>{row.stage}</td></tr>)}</tbody>
          </table></div>
        </section>}
      </div>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return <div className="card card-pad" style={{ boxShadow: 'none', textAlign: 'center' }}><div className="muted small">{title}</div><h2>{value}</h2></div>;
}
