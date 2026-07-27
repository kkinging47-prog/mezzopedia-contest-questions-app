'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

type SubmitState = {
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

async function fetchJsonWithTimeout(url: string, body: unknown, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
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

function markMissingQuestions(state: SubmitState) {
  const missing: number[] = [];
  state.questionIds.forEach((id, index) => {
    if (!state.answers[id]) missing.push(index + 1);
  });
  return missing;
}

export default function RobustTestSubmitGuard() {
  const pathname = usePathname();
  const stateRef = useRef<SubmitState>({ questionIds: [], answers: {}, submitting: false, startedAt: 0 });
  const originalFetchRef = useRef<any>(null);

  useEffect(() => {
    if (pathname !== '/test') return;
    if (typeof window === 'undefined') return;

    const state = stateRef.current;
    const originalFetch = window.fetch.bind(window);
    originalFetchRef.current = originalFetch;

    window.fetch = async (input: any, init?: any) => {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      const body = safeJsonParse(initBody(init));

      if (method === 'POST' && body && (url.includes('/api/session/answer') || url.includes('/api/session/progress'))) {
        if (body.answers && typeof body.answers === 'object') {
          state.answers = { ...state.answers, ...body.answers };
          delete state.answers.__resume;
        }
      }

      const response = await originalFetch(input, init);

      if (method === 'GET' && url.includes('/api/session')) {
        response.clone().json().then((json: any) => {
          if (Array.isArray(json?.questions)) state.questionIds = json.questions.map((q: any) => String(q.id)).filter(Boolean);
          if (json?.session?.answers && typeof json.session.answers === 'object') {
            state.answers = { ...state.answers, ...json.session.answers };
            delete state.answers.__resume;
          }
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
      if (questionId && optionId) state.answers = { ...state.answers, [questionId]: optionId };
    };

    const robustSubmit = async (button: HTMLButtonElement | null, force = false) => {
      if (state.submitting) return;
      state.submitting = true;
      state.startedAt = Date.now();
      setButtonState(button, true);

      const currentIndex = extractCurrentIndex();
      const currentQuestionId = state.questionIds[currentIndex];
      const currentSelected = selectedOptionFromDom();
      if (currentQuestionId && currentSelected) state.answers = { ...state.answers, [currentQuestionId]: currentSelected };

      const counter = answeredCounter();
      const allAnsweredByCounter = Boolean(counter && counter.total > 0 && counter.answered >= counter.total);
      const allAnsweredByState = state.questionIds.length > 0 && state.questionIds.every(id => state.answers[id]);

      if (!force && !allAnsweredByCounter && !allAnsweredByState) {
        state.submitting = false;
        setButtonState(button, false);
        const missing = markMissingQuestions(state).slice(0, 20);
        const suffix = missing.length ? ` Missing: ${missing.join(', ')}` : '';
        showPanel(`Some questions are still unanswered. Please answer all questions before submitting.${suffix}`, 'error');
        return;
      }

      const payload = {
        force,
        clientFinalSubmit: true,
        currentQuestionIndex: currentIndex,
        answers: state.answers
      };

      let lastMessage = 'Could not submit test. Please check your internet and try again.';
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          showPanel(attempt === 1 ? 'Submitting your test securely...' : 'Network was slow. Retrying submission now...', 'info');
          const { response, json } = await fetchJsonWithTimeout('/api/session/submit', payload, 26000);
          if (response.ok || json?.success) {
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
            ? 'The submission request took too long. Please try again. If it was already received, the Results page will open after retry.'
            : 'Network issue while submitting. Please try again.';
        }
      }

      state.submitting = false;
      setButtonState(button, false);
      showPanel(`${lastMessage} Tap Submit Test again. Do not refresh the page.`, 'error');
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
        showPanel('Unexpected submission error. Tap Submit Test again. Do not refresh the page.', 'error');
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
          showPanel('Submission is taking too long. Tap Retry Submit once. Do not refresh the page.', 'error');
        }
      }
    }, 5000);

    document.addEventListener('click', onClickCapture, true);

    return () => {
      document.removeEventListener('click', onClickCapture, true);
      window.clearInterval(watchdog);
      if (originalFetchRef.current) window.fetch = originalFetchRef.current;
    };
  }, [pathname]);

  return null;
}
