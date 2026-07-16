'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

type AnalysisResult = {
  unansweredNumbers: number[];
  unansweredButtons: HTMLButtonElement[];
  total: number;
};

function questionButtons() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.question-nav button'))
    .filter(button => /^\d+$/.test((button.textContent || '').trim()));
}

function currentQuestionHasSelectedOption() {
  return Boolean(document.querySelector('.option.selected'));
}

function isAnswered(button: HTMLButtonElement) {
  const text = (button.textContent || '').trim();
  const active = button.classList.contains('active');
  const inlineStyle = button.getAttribute('style') || '';
  const computed = window.getComputedStyle(button);
  const looksAnswered = inlineStyle.includes('#0f8a4b') || computed.backgroundColor === 'rgb(15, 138, 75)';
  if (active) return currentQuestionHasSelectedOption() || looksAnswered;
  return looksAnswered || button.dataset.answerState === 'answered';
}

function analyze(): AnalysisResult {
  const buttons = questionButtons();
  const unansweredButtons = buttons.filter(button => !isAnswered(button));
  const unansweredNumbers = unansweredButtons.map(button => Number((button.textContent || '').trim())).filter(Boolean);
  return { unansweredNumbers, unansweredButtons, total: buttons.length };
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
  questionButtons().forEach(button => button.classList.remove('unanswered-guard-mark'));
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
  if (!result.unansweredNumbers.length) {
    existing?.remove();
    markUnanswered(result);
    return;
  }

  const panel = promptContainer();
  if (!panel) return;
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

export default function TestSubmitGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== '/test') return;
    ensureStyle();

    const refresh = () => window.setTimeout(() => renderPrompt(analyze(), false), 120);
    const onClickCapture = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('button');
      if (!button) return;
      const label = (button.textContent || '').trim().toLowerCase();
      if (label.includes('submit test')) {
        const result = analyze();
        if (result.unansweredNumbers.length) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          renderPrompt(result, true);
          return;
        }
      }
      refresh();
    };

    document.addEventListener('click', onClickCapture, true);
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    refresh();

    return () => {
      document.removeEventListener('click', onClickCapture, true);
      observer.disconnect();
      questionButtons().forEach(button => button.classList.remove('unanswered-guard-mark'));
      document.querySelector('[data-unanswered-guard="true"]')?.remove();
    };
  }, [pathname]);

  return null;
}
