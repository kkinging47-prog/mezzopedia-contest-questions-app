'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

type AnalysisResult = {
  unansweredNumbers: number[];
  unansweredButtons: HTMLButtonElement[];
  total: number;
  answered: number;
  allAnsweredByCounter: boolean;
};

const ANSWER_CACHE_KEY = 'mezzopedia.test.answerCache.v1';

function questionButtons() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.question-nav button'))
    .filter(button => /^\d+$/.test((button.textContent || '').trim()));
}

function answeredCounter() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('.small.muted'));
  for (const node of nodes) {
    const match = (node.textContent || '').match(/Answered:\s*(\d+)\s*\/\s*(\d+)/i);
    if (match) {
      const answered = Number(match[1]);
      const total = Number(match[2]);
      if (Number.isFinite(answered) && Number.isFinite(total) && total > 0) return { answered, total };
    }
  }
  return null;
}

function currentQuestionHasSelectedOption() {
  return Boolean(document.querySelector('.option.selected'));
}

function isAnswered(button: HTMLButtonElement) {
  const active = button.classList.contains('active');
  const inlineStyle = button.getAttribute('style') || '';
  const computed = window.getComputedStyle(button);
  const looksAnswered = inlineStyle.includes('#0f8a4b') || computed.backgroundColor === 'rgb(15, 138, 75)' || computed.backgroundColor === 'rgb(15 138 75)';
  if (active) return currentQuestionHasSelectedOption() || looksAnswered || button.dataset.answerState === 'answered';
  return looksAnswered || button.dataset.answerState === 'answered';
}

function isUnansweredWarning(node: HTMLElement) {
  return /unanswered\s+question/i.test(node.textContent || '');
}

function clearStaleUnansweredWarnings() {
  document.querySelector('[data-unanswered-guard="true"]')?.remove();
  questionButtons().forEach(button => {
    button.classList.remove('unanswered-guard-mark');
    button.removeAttribute('title');
  });

  // Some phones can keep the old red React/browser warning visible even after the
  // answer counter has correctly moved to 10/10. Hide only that stale unanswered
  // warning; leave other errors such as network errors visible.
  Array.from(document.querySelectorAll<HTMLElement>('.alert-error, .unanswered-guard-panel')).forEach(node => {
    if (isUnansweredWarning(node)) node.style.display = 'none';
  });
}

function restoreUnansweredWarningVisibility() {
  Array.from(document.querySelectorAll<HTMLElement>('.alert-error, .unanswered-guard-panel')).forEach(node => {
    if (isUnansweredWarning(node)) node.style.display = '';
  });
}

function analyze(): AnalysisResult {
  const buttons = questionButtons();
  const counter = answeredCounter();

  // The React test counter is the source of truth. If it says all questions are
  // answered, do not let this DOM helper show/block with a stale unanswered count.
  if (counter && counter.total > 0 && counter.answered >= counter.total) {
    clearStaleUnansweredWarnings();
    return { unansweredNumbers: [], unansweredButtons: [], total: counter.total, answered: counter.answered, allAnsweredByCounter: true };
  }

  restoreUnansweredWarningVisibility();
  const unansweredButtons = buttons.filter(button => !isAnswered(button));
  const unansweredNumbers = unansweredButtons.map(button => Number((button.textContent || '').trim())).filter(Boolean);
  return { unansweredNumbers, unansweredButtons, total: counter?.total || buttons.length, answered: counter?.answered || Math.max(0, buttons.length - unansweredButtons.length), allAnsweredByCounter: false };
}

function ensureStyle() {
  if (document.getElementById('test-submit-guard-style')) return;
  const style = document.createElement('style');
  style.id = 'test-submit-guard-style';
  style.textContent = `
    .unanswered-guard-mark {
      background: #dc2626 !important;
      color: #ffffff !important;
      border-color: #991b1b !important;
      box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.22) !important;
    }
    .unanswered-guard-panel {
      border: 1px solid #fecaca;
      background: #fff1f2;
      color: #991b1b;
      border-radius: 18px;
      padding: 14px 16px;
      margin: 16px 0;
      font-weight: 600;
    }
    .unanswered-guard-panel .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .unanswered-guard-panel button {
      border: 1px solid #dc2626;
      background: #dc2626;
      color: #ffffff;
      border-radius: 999px;
      padding: 7px 11px;
      cursor: pointer;
      font-weight: 800;
    }
  `;
  document.head.appendChild(style);
}

function markUnanswered(result: AnalysisResult) {
  questionButtons().forEach(button => {
    button.classList.remove('unanswered-guard-mark');
    button.removeAttribute('title');
  });
  result.unansweredButtons.forEach(button => {
    button.classList.add('unanswered-guard-mark');
    button.title = 'This question has not been answered yet';
  });
}

function promptContainer() {
  const card = document.querySelector<HTMLElement>('.card.card-pad');
  if (!card) return null;
  let panel = card.querySelector<HTMLElement>('[data-unanswered-guard="true"]');
  if (!panel) {
    panel = document.createElement('div');
    panel.dataset.unansweredGuard = 'true';
    panel.className = 'unanswered-guard-panel no-print';
    const header = card.querySelector('.flex.between.wrap');
    if (header) header.insertAdjacentElement('afterend', panel);
    else card.prepend(panel);
  }
  return panel;
}

function renderPrompt(result: AnalysisResult, shouldScroll = false) {
  const existing = document.querySelector<HTMLElement>('[data-unanswered-guard="true"]');
  if (!result.unansweredNumbers.length || result.allAnsweredByCounter) {
    existing?.remove();
    clearStaleUnansweredWarnings();
    return;
  }

  const panel = promptContainer();
  if (!panel) return;
  panel.style.display = '';
  const preview = result.unansweredNumbers.slice(0, 30);
  const extra = result.unansweredNumbers.length > preview.length ? ` and ${result.unansweredNumbers.length - preview.length} more` : '';
  panel.innerHTML = `
    <div>You still have ${result.unansweredNumbers.length} unanswered question(s). Please answer the red-numbered questions before submitting.</div>
    <div class="small" style="margin-top:6px;">Unanswered: ${preview.join(', ')}${extra}</div>
    <div class="chips">${preview.map(number => `<button type="button" data-go-question="${number}">${number}</button>`).join('')}</div>
  `;
  panel.onclick = event => {
    const target = event.target as HTMLElement;
    const number = Number(target.closest('[data-go-question]')?.getAttribute('data-go-question') || 0);
    if (!number) return;
    const navButton = questionButtons().find(button => Number((button.textContent || '').trim()) === number);
    navButton?.click();
  };
  markUnanswered(result);
  if (shouldScroll) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function parseJsonBody(body: BodyInit | null | undefined) {
  if (!body || typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function fetchUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url || '';
}

function loadCachedAnswers() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(ANSWER_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function saveCachedAnswers(answers: Record<string, string>) {
  try { window.sessionStorage.setItem(ANSWER_CACHE_KEY, JSON.stringify(answers)); } catch { /* ignore private mode/storage errors */ }
}

function mergeAnswerPayload(target: Record<string, string>, payload: Record<string, unknown> | null) {
  const incoming = payload?.answers;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return;
  for (const [questionId, optionId] of Object.entries(incoming as Record<string, unknown>)) {
    if (questionId === '__resume') continue;
    const value = String(optionId || '').trim();
    if (questionId && value) target[String(questionId)] = value.slice(0, 12);
  }
  saveCachedAnswers(target);
}

function installSubmitFetchGuard() {
  const originalFetch = window.fetch.bind(window);
  const cachedAnswers = loadCachedAnswers();

  const patchedFetch: typeof window.fetch = async (input, init) => {
    const url = fetchUrl(input);
    const payload = parseJsonBody(init?.body);

    if (url.includes('/api/session/answer') || url.includes('/api/session/progress')) {
      mergeAnswerPayload(cachedAnswers, payload);
    }

    let nextInit = init;
    if (url.includes('/api/session/submit')) {
      const submitPayload = payload ? { ...payload } : {};
      const explicitAnswers = submitPayload.answers && typeof submitPayload.answers === 'object' && !Array.isArray(submitPayload.answers)
        ? submitPayload.answers as Record<string, unknown>
        : {};
      const answersToSend = { ...cachedAnswers };
      for (const [questionId, optionId] of Object.entries(explicitAnswers)) {
        const value = String(optionId || '').trim();
        if (questionId && value) answersToSend[questionId] = value.slice(0, 12);
      }
      submitPayload.answers = answersToSend;
      nextInit = {
        ...init,
        headers: { ...((init?.headers || {}) as Record<string, string>), 'Content-Type': 'application/json' },
        body: JSON.stringify(submitPayload)
      };
    }

    const response = await originalFetch(input, nextInit);
    if (url.includes('/api/session/submit') && response.ok) {
      try { window.sessionStorage.removeItem(ANSWER_CACHE_KEY); } catch { /* ignore */ }
    }
    return response;
  };

  window.fetch = patchedFetch;
  return () => {
    if (window.fetch === patchedFetch) window.fetch = originalFetch;
  };
}

export default function TestSubmitGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== '/test') return;
    ensureStyle();
    const restoreFetch = installSubmitFetchGuard();

    const refresh = () => window.setTimeout(() => {
      const existingPrompt = document.querySelector('[data-unanswered-guard="true"]');
      const result = analyze();
      document.body.dataset.testAnswered = `${result.answered}/${result.total}`;
      if (result.allAnsweredByCounter) {
        clearStaleUnansweredWarnings();
        return;
      }
      if (existingPrompt || result.unansweredNumbers.length === 0) renderPrompt(result, false);
      else markUnanswered(result);
    }, 120);

    const onClickCapture = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('button');
      if (!button) return;
      const label = (button.textContent || '').trim().toLowerCase();
      if (label.includes('submit test')) {
        const result = analyze();
        if (result.allAnsweredByCounter) {
          clearStaleUnansweredWarnings();
          return;
        }
        if (result.unansweredNumbers.length) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          renderPrompt(result, true);
          return;
        }
        renderPrompt(result, false);
      }
      refresh();
    };

    document.addEventListener('click', onClickCapture, true);
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    refresh();

    return () => {
      restoreFetch();
      document.removeEventListener('click', onClickCapture, true);
      observer.disconnect();
      questionButtons().forEach(button => button.classList.remove('unanswered-guard-mark'));
      document.querySelector('[data-unanswered-guard="true"]')?.remove();
      delete document.body.dataset.testAnswered;
    };
  }, [pathname]);

  return null;
}
