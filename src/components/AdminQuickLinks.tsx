'use client';

import { usePathname } from 'next/navigation';

export default function AdminQuickLinks() {
  const pathname = usePathname();
  if (!pathname?.startsWith('/admin')) return null;

  return (
    <div
      className="no-print"
      style={{
        position: 'fixed',
        right: 18,
        bottom: 18,
        zIndex: 50,
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        maxWidth: 520
      }}
    >
      <a className="btn btn-light" href="/admin">Admin</a>
      <a className="btn btn-primary" href="/admin/question-settings">Question Settings</a>
      <a className="btn btn-light" href="/admin/stages">Stages</a>
      <a className="btn btn-light" href="/admin/performance">Performance</a>
      <a className="btn btn-success" href="/admin/completed-codes">Completed Codes / Reset</a>
    </div>
  );
}
