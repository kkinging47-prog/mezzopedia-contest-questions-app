'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'mezzopedia_app_version';
const RELOAD_KEY_PREFIX = 'mezzopedia_reloaded_for_';
const CHECK_INTERVAL_MS = 30000;
const ACTIVE_TEST_CHECK_INTERVAL_MS = 15000;

type VersionResponse = {
  success?: boolean;
  version?: string;
};

function isContestPage(pathname: string | null) {
  return pathname === '/test' || pathname === '/sign-in' || pathname === '/results';
}

function showReloadNotice(message: string) {
  if (typeof document === 'undefined') return;
  let notice = document.querySelector<HTMLElement>('[data-auto-refresh-notice="true"]');
  if (!notice) {
    notice = document.createElement('div');
    notice.dataset.autoRefreshNotice = 'true';
    notice.style.position = 'fixed';
    notice.style.left = '12px';
    notice.style.right = '12px';
    notice.style.bottom = '12px';
    notice.style.zIndex = '99999';
    notice.style.borderRadius = '16px';
    notice.style.padding = '14px 16px';
    notice.style.background = '#0f172a';
    notice.style.color = '#ffffff';
    notice.style.boxShadow = '0 16px 40px rgba(15,23,42,0.3)';
    notice.style.fontWeight = '700';
    notice.style.textAlign = 'center';
    document.body.appendChild(notice);
  }
  notice.textContent = message;
}

async function fetchVersion() {
  const response = await fetch(`/api/app-version?t=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' }
  });
  if (!response.ok) return '';
  const json = await response.json().catch(() => ({} as VersionResponse));
  return String(json?.version || '').trim();
}

export default function AutoRefreshOnUpdate() {
  const pathname = usePathname();
  const checkingRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isContestPage(pathname)) return;

    let stopped = false;
    const intervalMs = pathname === '/test' ? ACTIVE_TEST_CHECK_INTERVAL_MS : CHECK_INTERVAL_MS;

    const checkVersion = async () => {
      if (checkingRef.current || stopped) return;
      checkingRef.current = true;
      try {
        const latestVersion = await fetchVersion();
        if (!latestVersion || latestVersion === 'development') return;

        const storedVersion = window.localStorage.getItem(STORAGE_KEY);
        if (!storedVersion) {
          window.localStorage.setItem(STORAGE_KEY, latestVersion);
          return;
        }

        if (storedVersion === latestVersion) return;

        window.localStorage.setItem(STORAGE_KEY, latestVersion);
        const reloadKey = `${RELOAD_KEY_PREFIX}${latestVersion}`;
        if (window.sessionStorage.getItem(reloadKey)) return;
        window.sessionStorage.setItem(reloadKey, '1');

        showReloadNotice('A new Mezzopedia update is available. Refreshing automatically so your test works correctly...');
        window.setTimeout(() => {
          window.location.reload();
        }, 1600);
      } catch {
        // Do not disturb candidates if the version check fails.
      } finally {
        checkingRef.current = false;
      }
    };

    checkVersion();
    const timer = window.setInterval(checkVersion, intervalMs);
    const onFocus = () => checkVersion();
    const onVisibility = () => { if (!document.hidden) checkVersion(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pathname]);

  return null;
}
