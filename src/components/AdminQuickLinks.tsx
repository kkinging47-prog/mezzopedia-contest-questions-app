'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const ROWS_PER_PAGE = 20;

function pageNumbers(current: number, total: number) {
  if (total <= 12) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set<number>([1, total]);
  for (let page = Math.max(2, current - 2); page <= Math.min(total - 1, current + 2); page += 1) pages.add(page);
  return Array.from(pages).sort((a, b) => a - b);
}

function button(label: string, onClick: () => void, disabled = false, active = false) {
  const item = document.createElement('button');
  item.type = 'button';
  item.textContent = label;
  item.disabled = disabled;
  item.className = active ? 'btn btn-primary' : 'btn btn-light';
  item.style.padding = '8px 12px';
  item.style.minWidth = '42px';
  item.onclick = onClick;
  return item;
}

function paginateAdminTables() {
  const tables = Array.from(document.querySelectorAll<HTMLTableElement>('main table'));

  tables.forEach((table, tableIndex) => {
    const tbody = table.tBodies?.[0];
    if (!tbody) return;

    const rows = Array.from(tbody.rows);
    const wrapper = table.closest('.table-wrap') || table.parentElement;
    if (!wrapper) return;

    const existing = wrapper.parentElement?.querySelector<HTMLElement>(`:scope > [data-pagination-for="${table.dataset.paginationId || `admin-table-${tableIndex}`}"]`);

    if (rows.length <= ROWS_PER_PAGE) {
      rows.forEach(row => { row.style.display = ''; });
      existing?.remove();
      return;
    }

    const tableId = table.dataset.paginationId || `admin-table-${tableIndex}`;
    table.dataset.paginationId = tableId;

    let currentPage = Number(table.dataset.currentPage || '1');
    const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    table.dataset.currentPage = String(currentPage);

    const start = (currentPage - 1) * ROWS_PER_PAGE;
    const end = start + ROWS_PER_PAGE;
    rows.forEach((row, index) => {
      row.style.display = index >= start && index < end ? '' : 'none';
    });

    existing?.remove();
    const controls = document.createElement('div');
    controls.dataset.paginationFor = tableId;
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
      table.dataset.currentPage = String(page);
      paginateAdminTables();
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    pageWrap.appendChild(button('Prev', () => goTo(currentPage - 1), currentPage === 1));
    let lastShown = 0;
    for (const page of pageNumbers(currentPage, totalPages)) {
      if (lastShown && page > lastShown + 1) {
        const dots = document.createElement('span');
        dots.textContent = '...';
        dots.className = 'small muted';
        dots.style.padding = '0 4px';
        pageWrap.appendChild(dots);
      }
      pageWrap.appendChild(button(String(page), () => goTo(page), false, page === currentPage));
      lastShown = page;
    }
    pageWrap.appendChild(button('Next', () => goTo(currentPage + 1), currentPage === totalPages));
    controls.appendChild(pageWrap);

    wrapper.insertAdjacentElement('afterend', controls);
  });
}

export default function AdminQuickLinks() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!pathname?.startsWith('/admin')) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(paginateAdminTables, 150);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);

    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [pathname]);

  if (!pathname?.startsWith('/admin')) return null;

  return (
    <div className="no-print" style={{ position: 'fixed', left: 18, bottom: 18, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, maxWidth: 'calc(100vw - 36px)' }}>
      {open && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 10, borderRadius: 18, background: 'rgba(255,255,255,0.96)', boxShadow: '0 14px 40px rgba(15, 23, 42, 0.18)', border: '1px solid rgba(148, 163, 184, 0.35)', maxWidth: 820 }}>
          <a className="btn btn-light" href="/admin">Admin</a>
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
