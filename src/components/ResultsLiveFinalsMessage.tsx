'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

function requestUrl(input: any) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return String(input || '');
}

function requestMethod(input: any, init?: any) {
  return String(init?.method || input?.method || 'GET').toUpperCase();
}

export default function ResultsLiveFinalsMessage() {
  const pathname = usePathname();
  const [message, setMessage] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (pathname !== '/results') {
      setMessage('');
      setDismissed(false);
      return;
    }
    if (typeof window === 'undefined') return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: any, init?: any) => {
      const response = await originalFetch(input, init);
      const url = requestUrl(input);
      const method = requestMethod(input, init);

      if (method === 'POST' && url.includes('/api/results/lookup')) {
        response.clone().json().then(json => {
          setDismissed(false);
          setMessage(String(json?.result?.notLiveFinalistMessage || ''));
        }).catch(() => setMessage(''));
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [pathname]);

  if (pathname !== '/results' || dismissed || !message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9998,
        width: 'min(940px, calc(100vw - 24px))',
        borderRadius: 22,
        padding: '18px 22px',
        background: 'linear-gradient(135deg, #f8fafc, #e0f2fe)',
        color: '#0f172a',
        boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
        border: '2px solid rgba(59,130,246,0.35)'
      }}
    >
      <button
        type="button"
        aria-label="Close message"
        onClick={() => setDismissed(true)}
        style={{
          position: 'absolute',
          right: 12,
          top: 10,
          border: 0,
          borderRadius: 999,
          background: 'rgba(15,23,42,0.08)',
          color: '#0f172a',
          width: 30,
          height: 30,
          fontWeight: 900,
          cursor: 'pointer'
        }}
      >×</button>
      <div style={{ fontSize: 'clamp(1.4rem, 4vw, 2.2rem)', fontWeight: 900, lineHeight: 1.08, paddingRight: 28 }}>
        Thank you for participating
      </div>
      <p style={{ margin: '10px 0 0', fontSize: '1rem', lineHeight: 1.55, paddingRight: 18 }}>{message}</p>
      <p style={{ margin: '10px 0 0', fontWeight: 800 }}>
        Use “Download 3-Stage Summary PDF” on this page to keep your full report and prepare well for next year.
      </p>
    </div>
  );
}
