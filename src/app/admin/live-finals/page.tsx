'use client';

import { useEffect, useMemo, useState } from 'react';

type FinalistRow = {
  id: string;
  name: string;
  usercode: string;
  category: string;
  paymentStatus: string;
  currentStage: string;
  isActive: boolean;
  loginCount: number;
  lastLoginAt?: string;
};

type VisibilitySettings = {
  isOpen: boolean;
  resultsOpen: boolean;
  visible: boolean;
  openedAt?: string;
  closedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  note?: string;
};

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function csvSafe(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

export default function LiveFinalsReleasePage() {
  const [settings, setSettings] = useState<VisibilitySettings | null>(null);
  const [finalists, setFinalists] = useState<FinalistRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingRelease, setPendingRelease] = useState<boolean | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const categories = useMemo(() => ['All', ...Array.from(new Set(finalists.map(row => row.category).filter(Boolean))).sort()], [finalists]);
  const filteredFinalists = useMemo(() => {
    const q = search.trim().toLowerCase();
    return finalists.filter(row => {
      const categoryOk = category === 'All' || row.category === category;
      const searchOk = !q || [row.name, row.usercode, row.category, row.paymentStatus].some(value => String(value || '').toLowerCase().includes(q));
      return categoryOk && searchOk;
    });
  }, [finalists, search, category]);

  async function loadData() {
    setLoading(true);
    setError('');
    setMessage('Loading Live Finals release settings...');
    const res = await fetch('/api/admin/live-finals', { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(json.error || 'Could not load Live Finals settings. Make sure you are logged in as admin.');
      setMessage('');
      return;
    }
    setSettings(json.settings || null);
    setFinalists(json.finalists || []);
    setSelectedIds([]);
    setPendingRelease(null);
    setMessage('');
  }

  useEffect(() => { loadData(); }, []);

  async function setRelease(isOpen: boolean) {
    setPendingRelease(null);
    setLoading(true);
    setError('');
    setMessage(isOpen ? 'Opening Live Finals promotion visibility...' : 'Hiding Live Finals promotion visibility...');
    const res = await fetch('/api/admin/live-finals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isOpen })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(json.error || 'Could not update Live Finals visibility.');
      setMessage('');
      return;
    }
    setSettings(json.settings || null);
    setFinalists(json.finalists || []);
    setSelectedIds([]);
    setMessage(isOpen
      ? 'Live Finals promotion status is now open on the public results page.'
      : 'Live Finals promotion status is now hidden on the public results page.');
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  }

  function selectShown() {
    setSelectedIds(filteredFinalists.map(row => row.id));
  }

  async function removeFinalists(ids: string[], label = 'selected candidate(s)') {
    if (!ids.length) {
      setError('Select at least one Live Finals candidate first.');
      return;
    }

    const warning = `Remove ${ids.length} ${label} from Live Finals?\n\nThey will be returned to Stage 3, their code will be closed, and they will no longer see the Live Finals promotion banner when results are released.`;
    if (!confirm(warning)) return;

    setLoading(true);
    setError('');
    setMessage('Removing selected candidate(s) from Live Finals...');
    const res = await fetch('/api/admin/live-finals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'removeFromLiveFinals', participantIds: ids, returnStage: 'Stage 3' })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(json.error || 'Could not remove candidate(s) from Live Finals.');
      setMessage('');
      return;
    }
    setSettings(json.settings || null);
    setFinalists(json.finalists || []);
    setSelectedIds([]);
    setMessage(`Removed ${json.removedCount || 0} candidate(s) from Live Finals and returned them to ${json.returnedToStage || 'Stage 3'}.`);
  }

  function exportCsv() {
    const headers = ['Name', 'Usercode', 'Category', 'Payment', 'Current Stage', 'Access', 'Logins', 'Last Login'];
    const body = filteredFinalists.map(row => [
      row.name,
      row.usercode,
      row.category,
      row.paymentStatus,
      row.currentStage,
      row.isActive ? 'Open' : 'Closed',
      row.loginCount,
      formatDate(row.lastLoginAt)
    ].map(csvSafe).join(','));
    const csv = [headers.map(csvSafe).join(','), ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'live-finals-finalists.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const isOpen = Boolean(settings?.isOpen || settings?.resultsOpen || settings?.visible);
  const releasePanelTitle = pendingRelease
    ? 'Open Live Finals Results?'
    : 'Hide Live Finals Results?';
  const releasePanelText = pendingRelease
    ? 'Candidates assigned to Live Finals will see the PROMOTED TO LIVE FINALS banner when they check results.'
    : 'Candidates will still see their scores and scripts, but the Live Finals promotion banner will be hidden.';

  return (
    <main className="math-bg" style={{ paddingBottom: 40 }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Live Finals Release</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin">Back to Admin</a>
            <a className="btn btn-light" href="/admin/stages">Stage Controls</a>
            <a className="btn btn-light" href="/admin/participants">Participants</a>
            <button className="btn btn-light" onClick={loadData} disabled={loading}>Refresh</button>
          </div>
        </nav>

        {message && <div className="alert alert-info">{message}</div>}
        {error && <div className="alert alert-error">{error}</div>}

        <section className="card card-pad grid">
          <div>
            <span className={isOpen ? 'badge badge-good' : 'badge badge-warn'}>{isOpen ? 'OPEN TO CANDIDATES' : 'HIDDEN FROM CANDIDATES'}</span>
            <h1 style={{ marginTop: 12 }}>Control when candidates see Live Finals promotion</h1>
            <p className="muted">Promote the qualified candidates to Live Finals first from Stage Controls. Then come here and open the public announcement only when you are ready for candidates to check their results and see whether they have been promoted.</p>
          </div>

          <div className="grid grid-3">
            <Metric title="Visibility" value={isOpen ? 'Released' : 'Hidden'} />
            <Metric title="Assigned Finalists" value={String(finalists.length)} />
            <Metric title="Last Updated" value={formatDate(settings?.updatedAt)} />
          </div>

          <div className="alert alert-info">
            When this is hidden, a candidate assigned to Live Finals will still see their ordinary results and scripts, but the <strong>PROMOTED TO LIVE FINALS</strong> banner will not show. When you open it, only candidates whose assigned stage is <strong>Live Finals</strong> will see the promotion banner.
          </div>

          {pendingRelease !== null && <div className="alert alert-error" style={{ border: '2px solid rgba(220,38,38,0.28)' }}>
            <div className="flex between wrap" style={{ gap: 10 }}>
              <strong>{releasePanelTitle}</strong>
              <button type="button" className="btn btn-light" onClick={() => setPendingRelease(null)} disabled={loading}>Close ×</button>
            </div>
            <p style={{ marginTop: 10 }}>{releasePanelText}</p>
            <div className="flex wrap no-print">
              <button className={pendingRelease ? 'btn btn-success' : 'btn btn-danger'} onClick={() => setRelease(Boolean(pendingRelease))} disabled={loading}>{pendingRelease ? 'Yes, Open Live Finals Results' : 'Yes, Hide Live Finals Results'}</button>
              <button className="btn btn-light" onClick={() => setPendingRelease(null)} disabled={loading}>Cancel</button>
            </div>
          </div>}

          <div className="flex wrap no-print">
            <button className="btn btn-success" onClick={() => setPendingRelease(true)} disabled={loading || isOpen}>Open Live Finals Results</button>
            <button className="btn btn-danger" onClick={() => setPendingRelease(false)} disabled={loading || !isOpen}>Hide Live Finals Results</button>
            <button className="btn btn-light" onClick={selectShown} disabled={!filteredFinalists.length || loading}>Select Shown</button>
            <button className="btn btn-light" onClick={() => setSelectedIds([])} disabled={!selectedIds.length || loading}>Clear Selection</button>
            <button className="btn btn-danger" onClick={() => removeFinalists(selectedIds)} disabled={!selectedIds.length || loading}>Remove Selected ({selectedIds.length})</button>
            <button className="btn btn-primary" onClick={exportCsv} disabled={!filteredFinalists.length}>Export Finalists CSV</button>
          </div>

          {settings?.note && <p className="small muted">Status note: {settings.note}</p>}
          {settings?.updatedBy && <p className="small muted">Updated by: {settings.updatedBy}</p>}
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          <div className="grid grid-3 no-print">
            <label>
              <span className="label">Category</span>
              <select className="select" value={category} onChange={e => setCategory(e.target.value)}>
                {categories.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Search</span>
              <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, code, category" />
            </label>
            <div className="alert alert-info" style={{ margin: 0 }}>Showing {filteredFinalists.length} of {finalists.length} candidates assigned to Live Finals.</div>
          </div>

          {!loading && !finalists.length && <div className="alert alert-info" style={{ marginTop: 18 }}>No candidate is currently assigned to Live Finals. Go to Stage Controls, select Stage 3 results, choose the qualifiers, and promote them to Live Finals first.</div>}
          {!!filteredFinalists.length && <div className="table-wrap" style={{ marginTop: 18 }}><table>
            <thead><tr><th>Select</th><th>Name</th><th>Code</th><th>Category</th><th>Payment</th><th>Access</th><th>Logins</th><th>Last Login</th><th>Action</th></tr></thead>
            <tbody>{filteredFinalists.map(row => <tr key={row.id}>
              <td><input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggleSelected(row.id)} /></td>
              <td>{row.name}</td>
              <td><strong>{row.usercode}</strong></td>
              <td>{row.category}</td>
              <td>{row.paymentStatus}</td>
              <td>{row.isActive ? 'Open' : 'Closed'}</td>
              <td>{row.loginCount || 0}</td>
              <td>{formatDate(row.lastLoginAt)}</td>
              <td><button className="btn btn-danger no-print" onClick={() => removeFinalists([row.id], row.name || row.usercode)} disabled={loading}>Remove</button></td>
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
