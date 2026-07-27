'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';

export default function AssignPaidStageOneQuickAction() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [dismissed, setDismissed] = useState(false);

  if (pathname !== '/admin/stages' || dismissed) return null;

  async function assignPaidToStageOne() {
    const ok = window.confirm('Move ALL PAID candidates to Stage 1 now? This will open their codes, reset login count, cancel only unfinished active sessions, and leave unpaid/pending candidates unchanged. Stage 1 will be marked open, but any Stage 1 start/end schedule will still apply.');
    if (!ok) return;

    setLoading(true);
    setMessage('Assigning paid candidates to Stage 1...');
    const res = await fetch('/api/admin/stages/assign-paid-stage-one', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setMessage(json.error || 'Could not assign paid candidates to Stage 1.');
      return;
    }

    setMessage(`Assigned ${json.assignedCount || 0} paid candidate code(s) to Stage 1. Cancelled ${json.cancelledSessionCount || 0} unfinished active session(s). Refreshing counts...`);
    window.setTimeout(() => window.location.reload(), 1400);
  }

  return (
    <div
      className="card card-pad no-print"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 60,
        maxWidth: 390,
        border: '2px solid rgba(15, 138, 75, 0.35)',
        boxShadow: '0 18px 60px rgba(15, 23, 42, .22)'
      }}
    >
      <div className="flex between wrap" style={{ alignItems: 'flex-start' }}>
        <div>
          <strong>Stage 1 Quick Action</strong>
          <p className="small muted" style={{ margin: '6px 0 10px' }}>Move all paid candidates into Stage 1. Unpaid and pending candidates are not touched.</p>
        </div>
        <button className="btn btn-light" type="button" onClick={() => setDismissed(true)} style={{ padding: '8px 10px', minHeight: 34 }}>×</button>
      </div>
      <button className="btn btn-success" type="button" onClick={assignPaidToStageOne} disabled={loading} style={{ width: '100%' }}>
        {loading ? 'Assigning...' : 'Assign Paid Candidates to Stage 1'}
      </button>
      {message && <div className="small" style={{ marginTop: 10 }}>{message}</div>}
    </div>
  );
}
