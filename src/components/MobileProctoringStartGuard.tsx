'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

function isMobileBrowser() {
  if (typeof navigator === 'undefined') return false;
  return /Mobi|Android|iPad|iPhone|iPod/i.test(navigator.userAgent || '');
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function sameConstraintShape(a: unknown, b: unknown) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/**
 * Some mobile browsers, especially Android WebView/Chrome variants, can hang on
 * camera/microphone startup or fullscreen requests. This guard runs only on the
 * test page and makes those startup steps fail safely instead of freezing.
 */
export default function MobileProctoringStartGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== '/test') return;
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    const mobile = isMobileBrowser();
    const html = document.documentElement as any;
    const originalFullscreen = typeof html.requestFullscreen === 'function' ? html.requestFullscreen.bind(html) : null;
    const mediaDevices = navigator.mediaDevices as any;
    const originalGetUserMedia = typeof mediaDevices?.getUserMedia === 'function' ? mediaDevices.getUserMedia.bind(mediaDevices) : null;

    if (mobile && originalFullscreen) {
      // Mobile fullscreen prompts are a common source of freezing. The test page
      // already treats mobile screen/fullscreen more lightly, so make it a no-op.
      html.requestFullscreen = () => Promise.resolve();
    }

    if (originalGetUserMedia && mediaDevices) {
      mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
        const timeoutMs = mobile ? 16000 : 26000;
        try {
          return await withTimeout(originalGetUserMedia(constraints || { video: true, audio: true }), timeoutMs, 'Camera/microphone startup timed out. Please close other apps using the camera, refresh, and try again.');
        } catch (firstError) {
          if (!mobile) throw firstError;

          // Retry with simpler mobile constraints. Some phones reject ideal sizes
          // or simultaneous camera/mic requests, while a simpler request works.
          const simpleAudioVideo: MediaStreamConstraints = { video: { facingMode: 'user' }, audio: true };
          if (!sameConstraintShape(constraints, simpleAudioVideo)) {
            try {
              return await withTimeout(originalGetUserMedia(simpleAudioVideo), 14000, 'Simple mobile camera/microphone startup timed out.');
            } catch {
              // Fall through to camera-only fallback below.
            }
          }

          // Last resort: allow the candidate into the test with camera evidence
          // instead of freezing permanently on phones where microphone startup hangs.
          return await withTimeout(originalGetUserMedia({ video: { facingMode: 'user' }, audio: false }), 12000, 'Mobile camera startup timed out.');
        }
      };
    }

    return () => {
      if (mobile && originalFullscreen) html.requestFullscreen = originalFullscreen;
      if (mediaDevices && originalGetUserMedia) mediaDevices.getUserMedia = originalGetUserMedia;
    };
  }, [pathname]);

  return null;
}
