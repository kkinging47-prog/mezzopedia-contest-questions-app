'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

type SubmitState = {
  sessionId: string;
  questionIds: string[];
  answers: Record<string, string>;
  submitting: boolean;
  startedAt: number;
};

function isTestSubmitButton(button: HTMLButtonElement | null) {
  const label = (button?.textContent || '').trim().toLowerCase();
  return Boolean(button && (label.includes('submit test') || label.includes('retry submit')));
}

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

function answeredCounter() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('.small.muted'));
  for (const node of nodes) {
    const match = (node.textContent || '').match(/Answered:\s*(\d+)\s*\/\s*(\d+)/i);
    if (match) return { answered: Number(match[1]), total: Number(match[2]) };
  }
  return null;
}

function selectedOptionFromDom() {
  const selected = document.querySelector<HTMLButtonElement>('button.option.selected');
  return (selected?.querySelector('strong')?.textContent || '').replace('.', '').trim();
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
  let panel = card.querySelector<HTMLElement>('[data-robust-submit-panel="true"]');
  if (!panel) {
    panel = document.createElement('div');
    panel.setAttribute('data-robust-submit-panel', 'true');
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

function setButtonState(button: HTMLButtonElement | null, submitting: boolean) {
  if (!button) return;
  button.disabled = submitting;
  button.textContent = submitting ? 'Submitting... Please wait' : 'Submit Test';
}

async function fetchJsonWithTimeout(fetcher: typeof window.fetch, url: string, body: unknown, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store'
    });
    const json = await response.json().catch(() => ({}));
    return { response, json };
  } finally {
    window.clearTimeout(timer);
  }
}

function missingQuestionNumbers(state: SubmitState) {
  const missing: number[] = [];
  state.questionIds.forEach((id, index) => {
    if (!state.answers[id]) missing.push(index + 1);
  });
  return missing;
}

export default function RobustTestSubmitGuard() {
  const pathname = usePathname();
  const stateRef = useRef<SubmitState>({ sessionId: '', questionIds: [], answers: {}, submitting: false, startedAt: 0 });
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
        // The normal test page will show any real loading error. This helper should stay quiet.
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
      const index = extractCurrentIndex();
      const questionId = state.questionIds[index];
      if (questionId && optionId) mergeAnswers({ [questionId]: optionId });
      else loadSessionSnapshot().then(() => {
        const refreshedQuestionId = state.questionIds[extractCurrentIndex()];
        if (refreshedQuestionId && optionId) mergeAnswers({ [refreshedQuestionId]: optionId });
      });
    };

    const robustSubmit = async (button: HTMLButtonElement | null, force = false) => {
      if (state.submitting) return;
      state.submitting = true;
      state.startedAt = Date.now();
      setButtonState(button, true);

      if (!state.questionIds.length) await loadSessionSnapshot();

      const currentIndex = extractCurrentIndex();
      const currentQuestionId = state.questionIds[currentIndex];
      const currentSelected = selectedOptionFromDom();
      if (currentQuestionId && currentSelected) mergeAnswers({ [currentQuestionId]: currentSelected });

      const counter = answeredCounter();
      const allAnsweredByCounter = Boolean(counter && counter.total > 0 && counter.answered >= counter.total);
      const allAnsweredByState = state.questionIds.length > 0 && state.questionIds.every(id => state.answers[id]);

      if (!force && !allAnsweredByCounter && !allAnsweredByState) {
        state.submitting = false;
        setButtonState(button, false);
        const missing = missingQuestionNumbers(state).slice(0, 20);
        const suffix = missing.length ? ` Missing: ${missing.join(', ')}` : '';
        showPanel(`Some questions are still unanswered. Please answer all questions before submitting.${suffix}`, 'error');
        return;
      }

      const payload = {
        force,
        clientFinalSubmit: true,
        clientAnsweredCount: counter?.answered || Object.keys(state.answers).length,
        clientTotalQuestions: counter?.total || state.questionIds.length,
        currentQuestionIndex: currentIndex,
        answers: state.answers
      };

      let lastMessage = 'Could not submit test. Please check your internet and try again.';
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          showPanel(attempt === 1 ? 'Submitting your test securely...' : 'Network was slow. Retrying submission now...', 'info');
          const { response, json } = await fetchJsonWithTimeout(originalFetch, '/api/session/submit', payload, 26000);
          if (response.ok || json?.success) {
            if (state.sessionId) {
              try { window.localStorage.removeItem(storageKey(state.sessionId)); } catch { /* ignore */ }
            }
            showPanel('Submission received. Opening results...', 'success');
            window.location.assign('/results');
            return;
          }

          lastMessage = json?.error || lastMessage;
          if (response.status === 401 || response.status === 403 || /already ended|results page|no longer active/i.test(lastMessage)) {
            window.location.assign('/results');
            return;
          }

          if (response.status === 400) break;
        } catch (error: any) {
          lastMessage = error?.name === 'AbortError'
            ? 'The submission request took too long. Please tap Submit Test again.'
            : 'Network issue while submitting. Please tap Submit Test again.';
        }
      }

      state.submitting = false;
      setButtonState(button, false);
      showPanel(`${lastMessage} Do not close the page.`, 'error');
    };

    const onClickCapture = (event: MouseEvent) => {
      updateFromOptionClick(event);
      const button = (event.target as HTMLElement | null)?.closest('button') as HTMLButtonElement | null;
      if (!isTestSubmitButton(button)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      robustSubmit(button, false).catch(() => {
        state.submitting = false;
        setButtonState(button, false);
        showPanel('Unexpected submission error. Tap Submit Test again. Do not close the page.', 'error');
      });
    };

    const watchdog = window.setInterval(() => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(isTestSubmitButton) || null;
      if (button && button.disabled && (button.textContent || '').toLowerCase().includes('submitting')) {
        const elapsed = Date.now() - (state.startedAt || 0);
        if (!state.submitting || elapsed > 35000) {
          state.submitting = false;
          button.disabled = false;
          button.textContent = 'Retry Submit';
          showPanel('Submission is taking too long. Tap Retry Submit once. Do not close the page.', 'error');
        }
      }
    }, 5000);

    document.addEventListener('click', onClickCapture, true);

    return () => {
      document.removeEventListener('click', onClickCapture, true);
      window.clearInterval(watchdog);
      window.clearTimeout(delayedLoad);
      if (originalFetchRef.current) window.fetch = originalFetchRef.current;
    };
  }, [pathname]);

  return null;
}
