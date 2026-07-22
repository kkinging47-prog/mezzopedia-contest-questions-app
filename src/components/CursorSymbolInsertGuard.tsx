'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const SYMBOL_VALUES: Record<string, string> = {
  'x²': '²',
  'x³': '³',
  '√': '√',
  '∑': '∑',
  'π': 'π',
  'θ': 'θ',
  '×': '×',
  '÷': '÷',
  '≤': '≤',
  '≥': '≥',
  '≠': '≠',
  Fraction: ' (a)/(b) ',
  Power: ' xⁿ ',
  '½': '½',
  '¼': '¼',
  '¾': '¾'
};

type TextInput = HTMLInputElement | HTMLTextAreaElement;

function textControl(element: Element | null): TextInput | null {
  if (!element) return null;
  if (element instanceof HTMLTextAreaElement) return element;
  if (element instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'password', ''].includes(element.type)) return element;
  return null;
}

function symbolButton(target: EventTarget | null): { button: HTMLButtonElement; symbol: string } | null {
  if (!(target instanceof Element)) return null;
  const button = target.closest('button');
  if (!(button instanceof HTMLButtonElement)) return null;
  const label = (button.textContent || '').trim();
  const symbol = SYMBOL_VALUES[label];
  if (!symbol) return null;
  return { button, symbol };
}

function insertSymbolAtCursor(input: TextInput, symbol: string) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const nextValue = `${before}${symbol}${after}`;
  input.value = nextValue;

  const nextPosition = start + symbol.length;
  input.setSelectionRange(nextPosition, nextPosition);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: symbol }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  window.setTimeout(() => {
    input.focus();
    input.setSelectionRange(nextPosition, nextPosition);
  }, 0);
}

export default function CursorSymbolInsertGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname?.startsWith('/admin')) return;

    let lastFocusedInput: TextInput | null = null;

    const rememberInput = (event: Event) => {
      const input = textControl(event.target instanceof Element ? event.target : null);
      if (input) lastFocusedInput = input;
    };

    const blockSymbolClick = (event: Event) => {
      const found = symbolButton(event.target);
      if (!found) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const handleSymbolPointer = (event: Event) => {
      const found = symbolButton(event.target);
      if (!found) return;

      const activeInput = textControl(document.activeElement) || lastFocusedInput;
      if (!activeInput) return;

      event.preventDefault();
      event.stopPropagation();
      insertSymbolAtCursor(activeInput, found.symbol);
    };

    document.addEventListener('focusin', rememberInput, true);
    document.addEventListener('keyup', rememberInput, true);
    document.addEventListener('mouseup', rememberInput, true);
    document.addEventListener('select', rememberInput, true);
    document.addEventListener('pointerdown', handleSymbolPointer, true);
    document.addEventListener('click', blockSymbolClick, true);

    return () => {
      document.removeEventListener('focusin', rememberInput, true);
      document.removeEventListener('keyup', rememberInput, true);
      document.removeEventListener('mouseup', rememberInput, true);
      document.removeEventListener('select', rememberInput, true);
      document.removeEventListener('pointerdown', handleSymbolPointer, true);
      document.removeEventListener('click', blockSymbolClick, true);
    };
  }, [pathname]);

  return null;
}
