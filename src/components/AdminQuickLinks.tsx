'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const ROWS_PER_PAGE = 20;
const paginationState = new Map<string, number>();
let isRenderingPagination = false;

function pageNumbers(current: number, total: number) {
  if (total <= 12) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set<number>([1, total]);
  for (let page = Math.max(2, current - 2); page <= Math.min(total - 1, current + 2); page += 1) pages.add(page);
  return Array.from(pages).sort((a, b) => a - b);
}

function makeSafeTableId(pathname: string, table: HTMLTableElement, tableIndex: number) {
  const headings = Array.from(table.tHead?.rows?.[0]?.cells || []).map(cell => cell.textContent?.trim() || '').join('-');
  const base = `${pathname}-${tableIndex}-${headings}`;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 90) || `admin-table-${tableIndex}`;
}

function makeButton(label: string, disabled: boolean, active: boolean, onClick: () => void) {
  const item = document.createElement('button');
  item.type = 'button';
  item.textContent = label;
  item.disabled = disabled;
  item.className = active ? 'btn btn-primary' : 'btn btn-light';
  item.style.padding = '8px 12px';
  item.style.minWidth = label.length <= 3 ? '42px' : '64px';
  item.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled) onClick();
  });
  return item;
}

function renderAdminTablePagination(pathname: string) {
  if (isRenderingPagination) return;
  isRenderingPagination = true;

  try {
    document.querySelectorAll<HTMLElement>('[data-admin-pagination="true"]').forEach(item => item.remove());
    const tables = Array.from(document.querySelectorAll<HTMLTableElement>('main table'));

    tables.forEach((table, tableIndex) => {
      const tbody = table.tBodies?.[0];
      if (!tbody) return;
      const rows = Array.from(tbody.rows);
      const wrapper = table.closest('.table-wrap') || table.parentElement;
      if (!wrapper) return;

      rows.forEach(row => { row.style.display = ''; });
      if (rows.length <= ROWS_PER_PAGE) return;

      const tableId = makeSafeTableId(pathname, table, tableIndex);
      const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
      const currentPage = Math.min(Math.max(1, paginationState.get(tableId) || 1), totalPages);
      paginationState.set(tableId, currentPage);

      const start = (currentPage - 1) * ROWS_PER_PAGE;
      const end = start + ROWS_PER_PAGE;
      rows.forEach((row, index) => {
        row.style.display = index >= start && index < end ? '' : 'none';
      });

      const controls = document.createElement('div');
      controls.dataset.adminPagination = 'true';
      controls.className = 'no-print';
      controls.style.display = 'flex';
      controls.style.flexWrap = 'wrap';
      controls.style.gap = '8px';
      controls.style.alignItems = 'center';
      controls.style.justifyContent = 'space-between';
      controls.style.marginTop = '14px';
      controls.style.padding = '10px 0';

      const info = document.createElement('span');
      info.className = 'small muted';
      info.textContent = `Showing ${start + 1}-${Math.min(end, rows.length)} of ${rows.length} rows`;
      controls.appendChild(info);

      const pageWrap = document.createElement('div');
      pageWrap.style.display = 'flex';
      pageWrap.style.flexWrap = 'wrap';
      pageWrap.style.gap = '6px';
      pageWrap.style.alignItems = 'center';

      const goTo = (page: number) => {
        paginationState.set(tableId, Math.min(Math.max(1, page), totalPages));
        renderAdminTablePagination(pathname);
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };

      pageWrap.appendChild(makeButton('Prev', currentPage === 1, false, () => goTo(currentPage - 1)));
      let lastShown = 0;
      for (const page of pageNumbers(currentPage, totalPages)) {
        if (lastShown && page > lastShown + 1) {
          const dots = document.createElement('span');
          dots.textContent = '...';
          dots.className = 'small muted';
          dots.style.padding = '0 4px';
          pageWrap.appendChild(dots);
        }
        pageWrap.appendChild(makeButton(String(page), false, page === currentPage, () => goTo(page)));
        lastShown = page;
      }
      pageWrap.appendChild(makeButton('Next', currentPage === totalPages, false, () => goTo(currentPage + 1)));
      controls.appendChild(pageWrap);
      wrapper.insertAdjacentElement('afterend', controls);
    });
  } finally {
    window.setTimeout(() => { isRenderingPagination = false; }, 0);
  }
}

export default function AdminQuickLinks() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!pathname?.startsWith('/admin')) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (isRenderingPagination) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => renderAdminTablePagination(pathname), 250);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);

    const followUpTimers = [800, 1600, 3000].map(delay => window.setTimeout(schedule, delay));

    return () => {
      if (timer) clearTimeout(timer);
      followUpTimers.forEach(id => window.clearTimeout(id));
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [pathname]);

  if (!pathname?.startsWith('/admin')) return null;

  return (
    <div className="no-print" style={{ position: 'fixed', left: 18, bottom: 18, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, maxWidth: 'calc(100vw - 36px)' }}>
      {open && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 10, borderRadius: 18, background: 'rgba(255,255,255,0.96)', boxShadow: '0 14px 40px rgba(15, 23, 42, 0.18)', border: '1px solid rgba(148, 163, 184, 0.35)', maxWidth: 920 }}>
          <a className="btn btn-light" href="/admin">Admin</a>
          <a className="btn btn-primary" href="/admin/participants-import">Participants Import</a>
          <a className="btn btn-primary" href="/admin/bulk-questions">Bulk Questions</a>
          <a className="btn btn-light" href="/admin/certificates">Certificates</a>
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
