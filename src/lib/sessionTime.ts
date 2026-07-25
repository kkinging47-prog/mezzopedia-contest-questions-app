import { TEST_DURATION_MINUTES } from './constants';

export const TEST_DURATION_SECONDS = TEST_DURATION_MINUTES * 60;
export const RESUME_META_KEY = '__resume';

type ResumeMeta = {
  accumulatedTimeSeconds?: number;
  activeStartedAt?: string;
  lastSeenAt?: string;
  currentQuestionIndex?: number;
};

function numericSeconds(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : null;
}

function timestampMs(value: unknown) {
  if (!value) return 0;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function elapsedBetweenSeconds(start: unknown, end: unknown) {
  const startMs = timestampMs(start);
  const endMs = timestampMs(end);
  if (!startMs || !endMs || endMs < startMs) return 0;
  return Math.floor((endMs - startMs) / 1000);
}

export function clampSessionSeconds(value: unknown) {
  const numeric = numericSeconds(value);
  if (numeric === null) return 0;
  return Math.min(TEST_DURATION_SECONDS, Math.max(0, numeric));
}

export function getAnswers(sessionOrAnswers: any) {
  const value = sessionOrAnswers?.answers || sessionOrAnswers || {};
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function publicAnswers(sessionOrAnswers: any) {
  const answers = { ...getAnswers(sessionOrAnswers) };
  delete answers[RESUME_META_KEY];
  return answers as Record<string, string>;
}

export function getResumeMeta(sessionOrAnswers: any): ResumeMeta {
  const answers = getAnswers(sessionOrAnswers);
  const meta = answers[RESUME_META_KEY];
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as ResumeMeta : {};
}

export function currentQuestionIndexFrom(sessionOrAnswers: any) {
  return Math.max(0, Math.floor(Number(getResumeMeta(sessionOrAnswers).currentQuestionIndex || 0) || 0));
}

export function activeElapsedSeconds(session: any, now = new Date()) {
  const meta = getResumeMeta(session);
  const metaAccumulated = numericSeconds(meta.accumulatedTimeSeconds);
  const storedTime = numericSeconds(session?.time_used_seconds);
  const accumulated = clampSessionSeconds(metaAccumulated ?? storedTime ?? 0);

  // Normal live-session path: add time since the latest active browser start/checkpoint.
  const activeStartedAt = timestampMs(meta.activeStartedAt);
  if (activeStartedAt) {
    const activeSeconds = Math.max(0, Math.floor((now.getTime() - activeStartedAt) / 1000));
    return clampSessionSeconds(accumulated + activeSeconds);
  }

  // Fallback for older sessions or rare cases where resume metadata is missing.
  // This prevents valid submissions from showing 0m 0s simply because the hidden
  // resume metadata was not saved before submission.
  const endTime = session?.submitted_at || session?.updated_at || now.toISOString();
  const elapsedFromStart = elapsedBetweenSeconds(session?.started_at, endTime);

  if (elapsedFromStart > 0) return clampSessionSeconds(Math.max(accumulated, elapsedFromStart));
  return accumulated;
}

export function remainingSessionSeconds(session: any, now = new Date()) {
  return Math.max(0, TEST_DURATION_SECONDS - activeElapsedSeconds(session, now));
}

export function dynamicExpiresAt(session: any, now = new Date()) {
  return new Date(now.getTime() + remainingSessionSeconds(session, now) * 1000).toISOString();
}

export function answersWithResumeMeta(session: any, now = new Date(), incomingAnswers?: Record<string, unknown>, currentQuestionIndex?: number) {
  const answers = publicAnswers(session);
  if (incomingAnswers) {
    for (const [key, value] of Object.entries(incomingAnswers)) {
      if (key === RESUME_META_KEY) continue;
      if (value) answers[key] = String(value).slice(0, 12);
    }
  }

  const previousMeta = getResumeMeta(session);
  const meta: ResumeMeta = {
    accumulatedTimeSeconds: activeElapsedSeconds(session, now),
    activeStartedAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    currentQuestionIndex: typeof currentQuestionIndex === 'number' && Number.isFinite(currentQuestionIndex)
      ? Math.max(0, Math.floor(currentQuestionIndex))
      : Math.max(0, Math.floor(Number(previousMeta.currentQuestionIndex || 0) || 0))
  };

  return { ...answers, [RESUME_META_KEY]: meta };
}
