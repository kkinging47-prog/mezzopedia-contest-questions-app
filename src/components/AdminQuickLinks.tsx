'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';

export default function AdminQuickLinks() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (!pathname?.startsWith('/admin')) return null;

  return (
    <div className="no-print" style={{ position: 'fixed', left: 18, bottom: 18, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, maxWidth: 'calc(100vw - 36px)' }}>
      {open && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 10, borderRadius: 18, background: 'rgba(255,255,255,0.96)', boxShadow: '0 14px 40px rgba(15, 23, 42, 0.18)', border: '1px solid rgba(148, 163, 184, 0.35)', maxWidth: 760 }}>
          <a className="btn btn-light" href="/admin">Admin</a>
          <a className="btn btn-primary" href="/admin/certificates">Certificates</a>
          <a className="btn btn-light" href="/admin/questions">Questions Filter</a>
          <a className="btn btn-light" href="/admin/question-settings">Question Settings</a>
          <a className="btn btn-light" href="/admin/stages">Stages</a>
          <a className="btn btn-light" href="/admin/performance">Performance</a>
        </div>
      )}
      <button type="button" className="btn btn-primary" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label="Toggle admin tools">
        {open ? 'Hide Admin Tools' : 'Admin Tools'}
      </button>
    </div>
  );
}
