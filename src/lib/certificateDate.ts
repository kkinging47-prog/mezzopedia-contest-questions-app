import { CONTEST_STAGES } from './constants';

type StageSchedule = {
  startsAt?: string;
  endsAt?: string;
  isOpen?: boolean;
  updatedAt?: string;
  note?: string;
};

export type StageSettingsForCertificate = Record<string, StageSchedule>;

function validDate(value: unknown) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // Already a date input value.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  // Ghana is UTC, and stage dates are stored as ISO values from the admin page.
  return date.toISOString().slice(0, 10);
}

export function certificateDateForStage(stageSettings: unknown, stage?: string, fallbackDate?: string) {
  const settings = stageSettings && typeof stageSettings === 'object' && !Array.isArray(stageSettings)
    ? stageSettings as StageSettingsForCertificate
    : {};

  const normalizedStage = CONTEST_STAGES.find(item => item.toLowerCase() === String(stage || '').trim().toLowerCase()) || '';
  const exactStageDate = normalizedStage ? validDate(settings[normalizedStage]?.endsAt) : null;
  if (exactStageDate) return exactStageDate;

  const latestScheduledEnd = CONTEST_STAGES
    .map(item => settings[item]?.endsAt)
    .map(value => ({ raw: value, time: value ? new Date(String(value)).getTime() : 0 }))
    .filter(item => item.raw && Number.isFinite(item.time) && item.time > 0)
    .sort((a, b) => b.time - a.time)[0];

  if (latestScheduledEnd?.raw) return validDate(latestScheduledEnd.raw) || validDate(fallbackDate) || '';
  return validDate(fallbackDate) || '';
}
