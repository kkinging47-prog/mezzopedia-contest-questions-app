'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type Promotion = {
  isPromoted?: boolean;
  promotedTo?: string;
  fromStage?: string;
  currentStage?: string;
};

function requestUrl(input: any) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return String(input || '');
}

function requestMethod(input: any, init?: any) {
  return String(init?.method || input?.method || 'GET').toUpperCase();
}

function promotionFromResult(json: any): Promotion | null {
  const promotion = json?.result?.promotion;
  if (promotion?.isPromoted && promotion?.promotedTo) return promotion;

  const currentStage = String(json?.result?.currentStage || json?.result?.participant?.currentStage || '').trim();
  const resultStage = String(json?.result?.stage || '').trim();
  if (currentStage && resultStage && currentStage !== resultStage) {
    return { isPromoted: true, promotedTo: currentStage, fromStage: resultStage, currentStage };
  }

  return null;
}

export default function ResultsPromotionBanner() {
  const pathname = usePathname();
  const [promotion, setPromotion] = useState<Promotion | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (pathname !== '/results') {
      setPromotion(null);
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
          setPromotion(promotionFromResult(json));
        }).catch(() => setPromotion(null));
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [pathname]);

  if (pathname !== '/results' || dismissed || !promotion?.isPromoted || !promotion.promotedTo) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        width: 'min(940px, calc(100vw - 24px))',
        borderRadius: 22,
        padding: '18px 22px',
        background: 'linear-gradient(135deg, #0f8a4b, #0b57d0)',
        color: 'white',
        boxShadow: '0 20px 50px rgba(15, 23, 42, 0.28)',
        border: '2px solid rgba(255,255,255,0.55)',
        textAlign: 'center'
      }}
    >
      <button
        type="button"
        aria-label="Close promotion banner"
        onClick={() => setDismissed(true)}
        style={{
          position: 'absolute',
          right: 12,
          top: 10,
          border: 0,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.18)',
          color: 'white',
          width: 30,
          height: 30,
          fontWeight: 900,
          cursor: 'pointer'
        }}
      >×</button>
      <div style={{ fontSize: 'clamp(1.7rem, 5vw, 3rem)', fontWeight: 1000, letterSpacing: 0.5, textTransform: 'uppercase', lineHeight: 1.05, paddingRight: 24 }}>
        Promoted to {promotion.promotedTo}
      </div>
      <div style={{ fontSize: 'clamp(1rem, 2.5vw, 1.35rem)', fontWeight: 800, marginTop: 6 }}>
        of the Mezzopedia National Mathematics Competition
      </div>
      {promotion.fromStage && <div style={{ marginTop: 8, opacity: 0.92, fontWeight: 600 }}>Qualified from {promotion.fromStage}</div>}
    </div>
  );
}
