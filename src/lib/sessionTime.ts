import { TEST_DURATION_MINUTES } from './constants';

export const TEST_DURATION_SECONDS = TEST_DURATION_MINUTES * 60;

export function clampSessionSeconds(value: unknown) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(TEST_DURATION_SECONDS, Math.max(0, Math.floor(numeric)));
}

export function activeElapsedSeconds(session: any, now = new Date()) {
  const accumulated = clampSessionSeconds(session?.accumulated_time_seconds);
  const activeStartedAt = session?.active_started_at ? new Date(session.active_started_at).getTime() : 0;
  if (!activeStartedAt || Number.isNaN(activeStartedAt)) return accumulated;
  const activeSeconds = Math.max(0, Math.floor((now.getTime() - activeStartedAt) / 1000));
  return clampSessionSeconds(accumulated + activeSeconds);
}

export function remainingSessionSeconds(session: any, now = new Date()) {
  return Math.max(0, TEST_DURATION_SECONDS - activeElapsedSeconds(session, now));
}

export function dynamicExpiresAt(session: any, now = new Date()) {
  return new Date(now.getTime() + remainingSessionSeconds(session, now) * 1000).toISOString();
}

export function progressUpdateFor(session: any, now = new Date(), currentQuestionIndex?: number) {
  const update: Record<string, unknown> = {
    accumulated_time_seconds: activeElapsedSeconds(session, now),
    active_started_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    updated_at: now.toISOString()
  };
  if (typeof currentQuestionIndex === 'number' && Number.isFinite(currentQuestionIndex)) {
    update.current_question_index = Math.max(0, Math.floor(currentQuestionIndex));
  }
  return update;
}
