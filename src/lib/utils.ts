import { CONTEST_STAGES } from './constants';

export function jsonError(message: string, status = 400) {
  return Response.json({ success: false, error: message }, { status });
}

export function shuffle<T>(items: T[]) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function secondsBetween(startIso?: string | null, endIso?: string | null) {
  if (!startIso || !endIso) return 0;
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000));
}

export function percentage(score: number, total: number) {
  return total > 0 ? Math.round((score / total) * 100) : 0;
}

export function normalizeCategory(category: string) {
  return category.trim();
}

export function normalizeContestStage(value: unknown) {
  const raw = String(value || '').trim();
  const match = CONTEST_STAGES.find(stage => stage.toLowerCase() === raw.toLowerCase());
  return match || 'Stage 1';
}

export function safeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
