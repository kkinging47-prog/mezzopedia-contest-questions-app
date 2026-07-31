'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

type TimedOutState = {
  sessionId: string;
  questionIds: string[];
  answers: Record<string, string>;
  submitting: boolean;
};

function safeJsonParse(value: unknown): any {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function requestUrl(input: any) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return String(input || '');
}

function requestMethod(input: any, init?: any) {
  return String(init?.method || input?.method || 'GET').toUpperCase();
}

function initBody(init?: any) {
  const body = init?.body;
  return typeof body === 'string' ? body : '';
}

function extractCurrentIndex() {
  const heading = Array.from(document.querySelectorAll('h1,h2,h3'))
    .map(node => node.textContent || '')
    .find(text => /question\s+\d+\s+of\s+\d+/i.test(text));
  const match = heading?.match(/question\s+(\d+)\s+of\s+\d+/i);
  if (match) return Math.max(0, Number(match[1]) - 1);

  const active = document.querySelector<HTMLButtonElement>('.question-nav button.active');
  const number = Number((active?.textContent || '').trim());
  return Number.isFinite(number) && number > 0 ? number - 1 : 0;
}

function selectedOptionFromDom() {
  const selected = document.querySelector<HTMLButtonElement>('button.option.selected');
  return (selected?.querySelector('strong')?.textContent || '').replace('.', '').trim();
}

function isTimeUpVisible() {
  const text = Array.from(document.querySelectorAll<HTMLElement>('.badge, nav, body'))
    .map(node => node.textContent || '')
    .join(' ');
  return /Time\s*Left:\s*00:00/i.test(text);
}

function storageKey(sessionId: string) {
  return sessionId ? `mezzopedia-final-answers-${sessionId}` : '';
}

function readStoredAnswers(sessionId: string) {
  const key = storageKey(sessionId);
  if (!key || typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function writeStoredAnswers(sessionId: string, answers: Record<string, string>) {
  const key = storageKey(sessionId);
  if (!key || typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(answers)); } catch { /* ignore */ }
}

function ensurePanel() {
  const card = document.querySelector<HTMLElement>('.card.card-pad');
  if (!card) return null;
  let panel = card.querySelector<HTMLElement>('[data-timeout-submit-panel="true"]');
  if (!panel) {
    panel = document.createElement('div');
    panel.setAttribute('data-timeout-submit-panel', 'true');
    panel.className = 'alert alert-info no-print';
    const actions = card.querySelector('.sticky-test-actions');
    if (actions) actions.insertAdjacentElement('beforebegin', panel);
    else card.appendChild(panel);
  }
  return panel;
}

function showPanel(message: string, mode: 'info' | 'error' | 'success' = 'info') {
  const panel = ensurePanel();
  if (!panel) return;
  panel.className = `alert ${mode === 'error' ? 'alert-error' : mode === 'success' ? 'alert-success' : 'alert-info'} no-print`;
  panel.textContent = message;
}

export default function TimedOutFinalSubmitGuard() {
  const pathname = usePathname();
  const stateRef = useRef<TimedOutState>({ sessionId: '', questionIds: [], answers: {}, submitting: false });
  const originalFetchRef = useRef<any>(null);

  useEffect(() => {
    if (pathname !== '/test') return;
    if (typeof window === 'undefined') return;

    const state = stateRef.current;
    const originalFetch = window.fetch.bind(window);
    originalFetchRef.current = originalFetch;

    function mergeAnswers(next: Record<string, unknown>) {
      const clean: Record<string, string> = {};
      for (const [questionId, optionId] of Object.entries(next || {})) {
        if (questionId === '__resume') continue;
        const value = String(optionId || '').trim();
        if (questionId && value) clean[questionId] = value;
      }
      state.answers = { ...state.answers, ...clean };
      if (state.sessionId) writeStoredAnswers(state.sessionId, state.answers);
    }

    async function loadSessionSnapshot() {
      try {
        const response = await originalFetch('/api/session', { cache: 'no-store' });
        const json = await response.clone().json().catch(() => ({}));
        if (!response.ok) return;
        if (json?.session?.id) state.sessionId = String(json.session.id);
        if (Array.isArray(json?.questions)) state.questionIds = json.questions.map((q: any) => String(q.id)).filter(Boolean);
        if (state.sessionId) state.answers = { ...state.answers, ...readStoredAnswers(state.sessionId) };
        if (json?.session?.answers && typeof json.session.answers === 'object') mergeAnswers(json.session.answers);
      } catch {
        // Keep this helper quiet. The main test page handles visible loading errors.
      }
    }

    function captureCurrentDomAnswer() {
      const currentIndex = extractCurrentIndex();
      const questionId = state.questionIds[currentIndex];
      const selected = selectedOptionFromDom();
      if (questionId && selected) mergeAnswers({ [questionId]: selected });
      return currentIndex;
    }

    async function submitTimedOutAnswers() {
      if (state.submitting) return;
      state.submitting = true;
      if (!state.questionIds.length) await loadSessionSnapshot();
      const currentQuestionIndex = captureCurrentDomAnswer();

      try {
        showPanel('Time is up. Submitting all selected answers now. Please do not close this page.', 'info');
        const response = await originalFetch('/api/session/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            force: true,
            timedOutAutoSubmit: true,
            clientFinalSubmit: true,
            currentQuestionIndex,
            answers: state.answers
          }),
          cache: 'no-store'
        });
        const json = await response.json().catch(() => ({}));
        if (response.ok || json?.success) {
          if (state.sessionId) {
            try { window.localStorage.removeItem(storageKey(state.sessionId)); } catch { /* ignore */ }
          }
          showPanel('Time is up. Selected answers submitted successfully. Opening results...', 'success');
          window.location.assign('/results');
          return;
        }
        showPanel(json?.error || 'Time is up, but submission could not complete. Please stay on this page and contact the administrator.', 'error');
      } catch {
        showPanel('Time is up, but the internet connection failed while submitting. Please keep this page open and reconnect.', 'error');
      } finally {
        state.submitting = false;
      }
    }

    loadSessionSnapshot();
    const delayedLoad = window.setTimeout(loadSessionSnapshot, 1500);

    window.fetch = async (input: any, init?: any) => {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      const body = safeJsonParse(initBody(init));

      if (method === 'POST' && body && (url.includes('/api/session/answer') || url.includes('/api/session/progress'))) {
        if (body.answers && typeof body.answers === 'object') mergeAnswers(body.answers);
      }

      if (method === 'POST' && url.includes('/api/session/submit')) {
        if (!state.questionIds.length) await loadSessionSnapshot();
        const currentQuestionIndex = captureCurrentDomAnswer();
        if (body?.answers && typeof body.answers === 'object') mergeAnswers(body.answers);
        const nextBody = {
          ...(body || {}),
          currentQuestionIndex: body?.currentQuestionIndex ?? currentQuestionIndex,
          clientFinalSubmit: true,
          answers: state.answers
        };
        init = { ...(init || {}), body: JSON.stringify(nextBody), headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } };
      }

      const response = await originalFetch(input, init);

      if (method === 'GET' && url.includes('/api/session')) {
        response.clone().json().then((json: any) => {
          if (json?.session?.id) state.sessionId = String(json.session.id);
          if (Array.isArray(json?.questions)) state.questionIds = json.questions.map((q: any) => String(q.id)).filter(Boolean);
          if (state.sessionId) state.answers = { ...state.answers, ...readStoredAnswers(state.sessionId) };
          if (json?.session?.answers && typeof json.session.answers === 'object') mergeAnswers(json.session.answers);
        }).catch(() => null);
      }

      return response;
    };

    const updateFromOptionClick = (event: MouseEvent) => {
      const optionButton = (event.target as HTMLElement | null)?.closest('button.option') as HTMLButtonElement | null;
      if (!optionButton) return;
      const optionId = (optionButton.querySelector('strong')?.textContent || '').replace('.', '').trim();
      const questionId = state.questionIds[extractCurrentIndex()];
      if (questionId && optionId) mergeAnswers({ [questionId]: optionId });
      else loadSessionSnapshot().then(() => {
        const refreshedQuestionId = state.questionIds[extractCurrentIndex()];
        if (refreshedQuestionId && optionId) mergeAnswers({ [refreshedQuestionId]: optionId });
      });
    };

    const timer = window.setInterval(() => {
      if (isTimeUpVisible() && !state.submitting) submitTimedOutAnswers().catch(() => null);
    }, 1000);

    document.addEventListener('click', updateFromOptionClick, true);

    return () => {
      document.removeEventListener('click', updateFromOptionClick, true);
      window.clearInterval(timer);
      window.clearTimeout(delayedLoad);
      if (originalFetchRef.current) window.fetch = originalFetchRef.current;
    };
  }, [pathname]);

  return null;
}
