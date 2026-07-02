'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CertificateSettings, DEFAULT_CERTIFICATE_SETTINGS, downloadCertificate, downloadCertificateBatch, normalizeCertificateSettings } from '@/lib/certificatePdf';

type Candidate = {
  sessionId: string;
  name: string;
  usercode: string;
  category: string;
  email?: string;
  submittedAt?: string;
};

type ConfigRow = { key: string; value: unknown };

export default function AdminCertificatesPage() {
  const [settings, setSettings] = useState<Required<CertificateSettings>>(DEFAULT_CERTIFICATE_SETTINGS);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const selectedCandidates = useMemo(() => candidates.filter(c => selectedIds.includes(c.sessionId)), [candidates, selectedIds]);
  const selectedAll = candidates.length > 0 && selectedIds.length === candidates.length;

  async function loadAll() {
    setLoading(true);
    setError('');
    const configRes = await fetch('/api/admin/config').then(r => r.json()).catch(() => ({}));
    const row = (configRes.config || []).find((item: ConfigRow) => item.key === 'certificateSettings');
    setSettings(normalizeCertificateSettings((row?.value || DEFAULT_CERTIFICATE_SETTINGS) as CertificateSettings));

    const candidateRes = await fetch('/api/admin/certificates/candidates').then(r => r.json()).catch(() => ({}));
    if (candidateRes.error) setError(candidateRes.error);
    setCandidates(candidateRes.candidates || []);
    setLoading(false);
  }

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) throw new Error('Admin login required.');
      return loadAll();
    }).catch(err => {
      setError(err.message || 'Could not open certificates page.');
      setLoading(false);
    });
  }, []);

  function update<K extends keyof CertificateSettings>(key: K, value: CertificateSettings[K]) {
    setSettings(prev => normalizeCertificateSettings({ ...prev, [key]: value }));
  }

  async function uploadTemplate(file: File | null) {
    if (!file) return;
    setMessage('Uploading certificate design...');
    setError('');
    const form = new FormData();
    form.append('file', file);
    form.append('folder', 'certificates');
    const res = await fetch('/api/admin/upload', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || 'Upload failed.'); setMessage(''); return; }
    setSettings(prev => normalizeCertificateSettings({ ...prev, templateUrl: json.url }));
    setMessage('Certificate design uploaded. Click Save Certificate Settings to keep it.');
  }

  async function saveSettings(event?: FormEvent) {
    event?.preventDefault();
    setMessage('');
    setError('');
    const res = await fetch('/api/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { certificateSettings: settings } })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || 'Could not save certificate settings.'); return; }
    setMessage('Certificate settings saved. Participants will now use this certificate template on the results page.');
  }

  function toggleCandidate(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  }

  function toggleAll() {
    setSelectedIds(selectedAll ? [] : candidates.map(c => c.sessionId));
  }

  async function downloadOne(candidate: Candidate) {
    await downloadCertificate({ name: candidate.name, category: candidate.category, usercode: candidate.usercode }, settings);
  }

  async function downloadSelected() {
    await downloadCertificateBatch(selectedCandidates.map(c => ({ name: c.name, category: c.category, usercode: c.usercode })), settings);
  }

  async function emailSelected() {
    if (!selectedIds.length) { setError('Select at least one candidate first.'); return; }
    setSending(true);
    setError('');
    setMessage('Sending certificate email(s)...');
    const res = await fetch('/api/admin/certificates/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: selectedIds, certificateDate: settings.certificateDate })
    });
    const json = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) { setError(json.error || 'Could not send certificate emails.'); setMessage(''); return; }
    setMessage(`Email sending complete. Sent: ${json.sent || 0}. Failed/skipped: ${(json.failed || []).length}. ${(json.failed || []).join('; ')}`);
  }

  return (
    <main className="math-bg" style={{ padding: '24px 0 80px' }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Certificate Manager</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin">Back to Admin</a>
            <button className="btn btn-primary" onClick={loadAll}>Refresh</button>
          </div>
        </nav>

        <section className="card card-pad">
          <span className="badge">Certificate of Participation</span>
          <h1 style={{ marginTop: 12 }}>Upload design and place candidate details</h1>
          <p className="muted">Upload your certificate design as PNG/JPG/WEBP. The system will add the participant name, category and selected date in the blank spaces you left.</p>
          {message && <div className="alert alert-success">{message}</div>}
          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={saveSettings} className="grid">
            <div className="grid grid-2">
              <label><span className="label">Upload certificate design</span><input type="file" accept="image/*" onChange={e => uploadTemplate(e.target.files?.[0] || null)} /></label>
              <label><span className="label">Certificate date</span><input className="input" type="date" value={settings.certificateDate} onChange={e => update('certificateDate', e.target.value)} /></label>
            </div>

            {settings.templateUrl && <div className="alert alert-info"><strong>Template uploaded:</strong> <a href={settings.templateUrl} target="_blank" rel="noreferrer">View certificate design</a></div>}

            <details open>
              <summary><strong>Text positions and font sizes</strong></summary>
              <p className="small muted">A4 landscape uses X from 0–297 and Y from 0–210. Increase Y to move text down. Increase X to move text right.</p>
              <div className="grid grid-3" style={{ marginTop: 12 }}>
                <NumberField label="Name X" value={settings.nameX} onChange={v => update('nameX', v)} />
                <NumberField label="Name Y" value={settings.nameY} onChange={v => update('nameY', v)} />
                <NumberField label="Name Font" value={settings.nameFontSize} onChange={v => update('nameFontSize', v)} />
                <NumberField label="Category X" value={settings.categoryX} onChange={v => update('categoryX', v)} />
                <NumberField label="Category Y" value={settings.categoryY} onChange={v => update('categoryY', v)} />
                <NumberField label="Category Font" value={settings.categoryFontSize} onChange={v => update('categoryFontSize', v)} />
                <NumberField label="Date X" value={settings.dateX} onChange={v => update('dateX', v)} />
                <NumberField label="Date Y" value={settings.dateY} onChange={v => update('dateY', v)} />
                <NumberField label="Date Font" value={settings.dateFontSize} onChange={v => update('dateFontSize', v)} />
                <label><span className="label">Text Color</span><input className="input" value={settings.textColor} onChange={e => update('textColor', e.target.value)} placeholder="#001f4d" /></label>
              </div>
            </details>

            <div className="flex wrap">
              <button className="btn btn-success" type="submit">Save Certificate Settings</button>
              {candidates[0] && <button type="button" className="btn btn-light" onClick={() => downloadOne(candidates[0])}>Preview with First Candidate</button>}
            </div>
          </form>
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          <div className="flex between wrap">
            <div>
              <h2>Completed candidates</h2>
              <p className="muted">Select candidates to generate certificates. Emails require participant email addresses and email environment variables.</p>
            </div>
            <div className="flex wrap no-print">
              <button className="btn btn-light" onClick={toggleAll}>{selectedAll ? 'Unselect All' : 'Select All'}</button>
              <button className="btn btn-primary" onClick={downloadSelected} disabled={!selectedIds.length}>Download Selected / All PDF</button>
              <button className="btn btn-success" onClick={emailSelected} disabled={!selectedIds.length || sending}>{sending ? 'Sending...' : 'Send Selected to Email'}</button>
            </div>
          </div>

          {loading && <div className="alert alert-info">Loading completed candidates...</div>}
          {!loading && !candidates.length && <div className="alert alert-info">No completed candidates found yet.</div>}

          {!!candidates.length && <div className="table-wrap">
            <table>
              <thead><tr><th>Select</th><th>Name</th><th>Code</th><th>Category</th><th>Email</th><th>Action</th></tr></thead>
              <tbody>{candidates.map(candidate => <tr key={candidate.sessionId}>
                <td><input type="checkbox" checked={selectedIds.includes(candidate.sessionId)} onChange={() => toggleCandidate(candidate.sessionId)} /></td>
                <td>{candidate.name}</td>
                <td>{candidate.usercode}</td>
                <td>{candidate.category}</td>
                <td>{candidate.email || <span className="muted">No email</span>}</td>
                <td><button className="btn btn-light" onClick={() => downloadOne(candidate)}>Download</button></td>
              </tr>)}</tbody>
            </table>
          </div>}
        </section>
      </div>
    </main>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label><span className="label">{label}</span><input className="input" type="number" step="1" value={value} onChange={e => onChange(Number(e.target.value || 0))} /></label>;
}
