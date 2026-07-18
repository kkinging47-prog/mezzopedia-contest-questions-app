import { CONTEST_STAGES } from './constants';
import { normalizeContestStage } from './utils';

export type StageAccessReason = 'open' | 'manual_closed' | 'not_started' | 'ended';
export type StageSetting = {
  isOpen?: boolean;
  note?: string;
  updatedAt?: string;
  startsAt?: string;
  endsAt?: string;
};
export type StageSettings = Record<string, StageSetting>;

export const DEFAULT_STAGE_SETTINGS: StageSettings = {
  'Stage 1': { isOpen: true, note: 'Initial online stage' },
  'Stage 2': { isOpen: false, note: 'Open after Stage 1 qualification' },
  'Stage 3': { isOpen: false, note: 'Open after Stage 2 qualification' }
};

export function normalizeStageSettings(value: unknown): StageSettings {
  const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value as StageSettings : {};
  const merged: StageSettings = {};
  for (const stage of CONTEST_STAGES) {
    const raw = incoming[stage] || incoming[normalizeContestStage(stage)] || {};
    merged[stage] = {
      ...DEFAULT_STAGE_SETTINGS[stage],
      ...raw,
      isOpen: typeof raw.isOpen === 'boolean' ? raw.isOpen : DEFAULT_STAGE_SETTINGS[stage]?.isOpen,
      startsAt: cleanIso(raw.startsAt),
      endsAt: cleanIso(raw.endsAt)
    };
  }
  return merged;
}

function cleanIso(value: unknown) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function formatStageDateTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Accra'
  }).format(date);
}

export function getStageAccess(stageSettings: StageSettings, stage: string, now = new Date()) {
  const normalizedStage = normalizeContestStage(stage);
  const settings = normalizeStageSettings(stageSettings)[normalizedStage] || DEFAULT_STAGE_SETTINGS[normalizedStage] || { isOpen: false };
  const nowMs = now.getTime();
  const startMs = settings.startsAt ? new Date(settings.startsAt).getTime() : 0;
  const endMs = settings.endsAt ? new Date(settings.endsAt).getTime() : 0;

  if (!settings.isOpen) {
    return {
      isAccessible: false,
      reason: 'manual_closed' as StageAccessReason,
      message: `${normalizedStage} is currently closed. Please wait for the contest administrator to open it.`
    };
  }

  if (startMs && Number.isFinite(startMs) && nowMs < startMs) {
    return {
      isAccessible: false,
      reason: 'not_started' as StageAccessReason,
      message: `${normalizedStage} has not started yet. It starts on ${formatStageDateTime(settings.startsAt)} Ghana time.`
    };
  }

  if (endMs && Number.isFinite(endMs) && nowMs > endMs) {
    return {
      isAccessible: false,
      reason: 'ended' as StageAccessReason,
      message: `${normalizedStage} has ended. It ended on ${formatStageDateTime(settings.endsAt)} Ghana time.`
    };
  }

  return {
    isAccessible: true,
    reason: 'open' as StageAccessReason,
    message: `${normalizedStage} is open.`
  };
}
