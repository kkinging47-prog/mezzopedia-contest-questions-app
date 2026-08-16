'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type Visibility = { isOpen: boolean; updatedAt?: string; note?: string };

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

export default function LiveFinalsVisibilityControl() {
  const pathname = usePathname();
  const [settings, setSettings] = useState<Visibility>({ isOpen: false });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const shouldShow = pathname === '/admin/live-finalists';

  useEffect(() => {
    if (!shouldShow) return;
    setLoading(true);
    fetch('/api/admin/live-finals-visibility', { cache: 'no-store' })
      .then(res => res.json())
      .then(json => {
        if (json.error) throw new Error(json.error);
        setSettings(json.settings || { isOpen: false });
      })
      .catch(err => setError(err.message || 'Could not load Live Finals visibility.'))
      .finally(() => setLoading(false));
  }, [shouldShow]);

  async function setVisibility(isOpen: boolean) {
    const confirmText = isOpen
      ? 'Open Live Finals visibility now? Finalists will see PROMOTED TO LIVE FINALS, and non-finalists will see the encouragement message.'
      : 'Hide Live Finals visibility now? Candidates will no longer see finalist/not-selected messages.';
    if (!confirm(confirmText)) return;

    setLoading(true);
    setError('');
    setMessage('');
    const res = await fetch('/api/admin/live-finals-visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isOpen })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(json.error || 'Could not update Live Finals visibility.'); return; }
    setSettings(json.settings || { isOpen });
    setMessage(isOpen ? 'Live Finals results are now visible to candidates.' : 'Live Finals results are now hidden from candidates.');
  }

  if (!shouldShow) return null;

  return (
    <div className="no-print" style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 55, maxWidth: 420 }}>
      <div className="card card-pad" style={{ boxShadow: '0 14px 40px rgba(15, 23, 42, 0.22)', border: settings.isOpen ? '2px solid rgba(15,138,75,0.35)' : '2px solid rgba(220,38,38,0.25)' }}>
        <span className={settings.isOpen ? 'badge badge-good' : 'badge badge-warn'}>{settings.isOpen ? 'Visible to candidates' : 'Hidden from candidates'}</span>
        <h3 style={{ margin: '10px 0 6px' }}>Live Finals Result Visibility</h3>
        <p className="small muted" style={{ marginTop: 0 }}>{settings.isOpen ? 'Candidates can now see Live Finals promotion/not-selected messages.' : 'Candidates cannot see Live Finals promotion/not-selected messages yet.'}</p>
        {settings.updatedAt && <p className="small muted">Last updated: {formatDate(settings.updatedAt)}</p>}
        {message && <div className="alert alert-success">{message}</div>}
        {error && <div className="alert alert-error">{error}</div>}
        <div className="flex wrap">
          <button className="btn btn-success" disabled={loading || settings.isOpen} onClick={() => setVisibility(true)}>Open for Candidates</button>
          <button className="btn btn-light" disabled={loading || !settings.isOpen} onClick={() => setVisibility(false)}>Hide for Now</button>
        </div>
      </div>
    </div>
  );
}
