'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

type SubmitState = {
  questionIds: string[];
  answers: Record<string, string>;
  confirmedAnswers: Record<string, string>;
  currentQuestionIndex: number;
  submitting: boolean;
  confirming: boolean;
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

function selectedOptionFromDom() {
  const selected = document.querySelector<HTMLButtonElement>('button.option.selected');
  return (selected?.querySelector('strong')?.textContent || '').replace('.', '').trim();
}

function answeredCounter() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('.small.muted'));
  for (const node of nodes) {
    const match = (node.textContent || '').match(/Answered:\s*(\d+)\s*\/\s*(\d+)/i);
    if (match) return { answered: Number(match[1]), total: Number(match[2]) };
  }
  return null;
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

function isForwardNavigationButton(button: HTMLButtonElement | null, currentIndex: number) {
  if (!button || isTestSubmitButton(button)) return false;
  const label = (button.textContent || '').trim().toLowerCase();
  if (label === 'next') return true;

  const number = Number(label);
  const isQuestionNav = Number.isFinite(number) && button.closest('.question-nav');
  if (!isQuestionNav) return false;
  return number - 1 > currentIndex;
}

function isNavigationButton(button: HTMLButtonElement | null) {
  if (!button || isTestSubmitButton(button)) return false;
  const label = (button.textContent || '').trim().toLowerCase();
  if (label === 'next' || label === 'previous') return true;

  const number = Number(label);
  return Number.isFinite(number) && Boolean(button.closest('.question-nav'));
}

export default function RobustTestSubmitGuard() {
  const pathname = usePathname();
  const stateRef = useRef<SubmitState>({ questionIds: [], answers: {}, confirmedAnswers: {}, currentQuestionIndex: 0, submitting: false, confirming: false, startedAt: 0 });
  const originalFetchRef = useRef<any>(null);
  const bypassNavigationRef = useRef(false);

  useEffect(() => {
    if (pathname !== '/test') return;
    if (typeof window === 'undefined') return;

    const state = stateRef.current;
    const originalFetch = window.fetch.bind(window);
    originalFetchRef.current = originalFetch;

    async function saveAnswer(questionId: string, optionId: string, index: number, quiet = false) {
      if (!questionId || !optionId) return false;
      if (state.confirmedAnswers[questionId] === optionId) return true;

      try {
        if (!quiet) showPanel('Confirming and saving your selected answer...', 'info');
        const { response, json } = await fetchJsonWithTimeout('/api/session/answer', {
          answers: { [questionId]: optionId },
          currentQuestionIndex: index
        }, 12000);

        if (response.ok || json?.success) {
          state.answers = { ...state.answers, [questionId]: optionId };
          state.confirmedAnswers = { ...state.confirmedAnswers, [questionId]: optionId };
          if (!quiet) showPanel('Answer confirmed and saved. Moving on...', 'success');
          return true;
        }

        if (!quiet) showPanel(json?.error || 'Could not confirm this answer. Please check your internet and try again.', 'error');
      } catch {
        if (!quiet) showPanel('Network issue: could not confirm this answer. Please try again before moving on.', 'error');
      }

      return false;
    }

    function currentQuestionId() {
      return state.questionIds[extractCurrentIndex()] || '';
    }

    function currentOptionId() {
      const index = extractCurrentIndex();
      const questionId = state.questionIds[index] || '';
      return state.answers[questionId] || selectedOptionFromDom();
    }

    async function confirmCurrentBeforeMoving(button: HTMLButtonElement | null) {
      const index = extractCurrentIndex();
      const questionId = state.questionIds[index] || '';
      const optionId = currentOptionId();

      if (!questionId) {
        showPanel('Please wait for the test to finish loading before moving to another question.', 'error');
        return false;
      }

      if (!optionId) {
        showPanel('Please select an answer for this question before moving to the next question.', 'error');
        return false;
      }

      state.confirming = true;
      const oldText = button?.textContent || '';
      if (button) {
        button.disabled = true;
        button.textContent = 'Saving answer...';
      }
      const ok = await saveAnswer(questionId, optionId, index, false);
      state.confirming = false;
      if (button) {
        button.disabled = false;
        button.textContent = oldText;
      }
      return ok;
    }

    window.fetch = async (input: any, init?: any) => {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      const body = safeJsonParse(initBody(init));

      if (method === 'POST' && body && (url.includes('/api/session/answer') || url.includes('/api/session/progress'))) {
        if (body.answers && typeof body.answers === 'object') {
          state.answers = { ...state.answers, ...body.answers };
          delete state.answers.__resume;
        }
        if (Number.isFinite(Number(body.currentQuestionIndex))) state.currentQuestionIndex = Math.max(0, Math.floor(Number(body.currentQuestionIndex)));
      }

      const response = await originalFetch(input, init);

      if (method === 'GET' && url.includes('/api/session')) {
        response.clone().json().then((json: any) => {
          if (Array.isArray(json?.questions)) state.questionIds = json.questions.map((q: any) => String(q.id)).filter(Boolean);
          if (json?.session?.answers && typeof json.session.answers === 'object') {
            state.answers = { ...state.answers, ...json.session.answers };
            state.confirmedAnswers = { ...state.confirmedAnswers, ...json.session.answers };
          }
          if (Number.isFinite(Number(json?.session?.currentQuestionIndex))) state.currentQuestionIndex = Math.max(0, Math.floor(Number(json.session.currentQuestionIndex)));
          delete state.answers.__resume;
          delete state.confirmedAnswers.__resume;
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
      if (questionId && optionId) {
        state.currentQuestionIndex = index;
        state.answers = { ...state.answers, [questionId]: optionId };
        saveAnswer(questionId, optionId, index, true).catch(() => null);
        showPanel('Answer selected. It will be confirmed before moving to the next question.', 'info');
      }
    };

    const robustSubmit = async (button: HTMLButtonElement | null, force = false) => {
      if (state.submitting) return;
      state.submitting = true;
      state.startedAt = Date.now();
      setButtonState(button, true);
      showPanel('Submitting your test securely. Please do not refresh or close this page.', 'info');

      const counter = answeredCounter();
      const allAnsweredByCounter = Boolean(counter && counter.total > 0 && counter.answered >= counter.total);
      const allAnsweredByState = state.questionIds.length > 0 && state.questionIds.every(id => state.answers[id]);
      if (!force && !allAnsweredByCounter && !allAnsweredByState) {
        state.submitting = false;
        setButtonState(button, false);
        showPanel('Some questions are still unanswered. Please answer all questions before submitting.', 'error');
        return;
      }

      try {
        if (Object.keys(state.answers).length) {
          showPanel('Final confirmation of all saved answers...', 'info');
          await fetchJsonWithTimeout('/api/session/answer', {
            answers: state.answers,
            currentQuestionIndex: extractCurrentIndex()
          }, 12000).catch(() => null);
        }
      } catch {
        // The final submit endpoint will still receive the answers below.
      }

      const payload = {
        force,
        clientFinalSubmit: true,
        currentQuestionIndex: extractCurrentIndex(),
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
      if (!button) return;

      if (isTestSubmitButton(button)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        robustSubmit(button, false).catch(() => {
          state.submitting = false;
          setButtonState(button, false);
          showPanel('Unexpected submission error. Tap Submit Test again. Do not refresh the page.', 'error');
        });
        return;
      }

      if (!isNavigationButton(button)) return;
      const currentIndex = extractCurrentIndex();
      const movingForward = isForwardNavigationButton(button, currentIndex);
      const hasSelectedAnswer = Boolean(state.answers[currentQuestionId()] || selectedOptionFromDom());
      if (!movingForward && !hasSelectedAnswer) return;
      if (bypassNavigationRef.current) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      confirmCurrentBeforeMoving(button).then(ok => {
        if (!ok) return;
        bypassNavigationRef.current = true;
        button.click();
        window.setTimeout(() => { bypassNavigationRef.current = false; }, 0);
      }).catch(() => {
        state.confirming = false;
        showPanel('Could not confirm this answer. Please try again before moving on.', 'error');
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
