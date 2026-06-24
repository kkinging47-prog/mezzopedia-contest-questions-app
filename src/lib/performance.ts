export type PerformanceSettings = {
  contestLoadMode: boolean;
  answerSaveDelayMs: number;
  periodicSnapshotMs: number;
  cameraCheckMs: number;
  audioCheckMs: number;
  devtoolsCheckMs: number;
  evidenceCooldownMs: number;
  evidenceImageQuality: number;
  evidenceMaxWidth: number;
  audioClipMs: number;
  requireScreenShareDesktop: boolean;
  allowReducedProctoringOnIOS: boolean;
  maxDataUrlChars: number;
};

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  contestLoadMode: true,
  answerSaveDelayMs: 1500,
  periodicSnapshotMs: 45000,
  cameraCheckMs: 12000,
  audioCheckMs: 3500,
  devtoolsCheckMs: 10000,
  evidenceCooldownMs: 30000,
  evidenceImageQuality: 0.45,
  evidenceMaxWidth: 540,
  audioClipMs: 3000,
  requireScreenShareDesktop: true,
  allowReducedProctoringOnIOS: true,
  maxDataUrlChars: 1800000
};

function asNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function sanitizePerformanceSettings(input: unknown): PerformanceSettings {
  const raw = input && typeof input === 'object' ? input as Partial<PerformanceSettings> : {};
  const output: PerformanceSettings = {
    contestLoadMode: typeof raw.contestLoadMode === 'boolean' ? raw.contestLoadMode : DEFAULT_PERFORMANCE_SETTINGS.contestLoadMode,
    answerSaveDelayMs: asNumber(raw.answerSaveDelayMs, DEFAULT_PERFORMANCE_SETTINGS.answerSaveDelayMs, 500, 8000),
    periodicSnapshotMs: asNumber(raw.periodicSnapshotMs, DEFAULT_PERFORMANCE_SETTINGS.periodicSnapshotMs, 15000, 180000),
    cameraCheckMs: asNumber(raw.cameraCheckMs, DEFAULT_PERFORMANCE_SETTINGS.cameraCheckMs, 5000, 120000),
    audioCheckMs: asNumber(raw.audioCheckMs, DEFAULT_PERFORMANCE_SETTINGS.audioCheckMs, 1500, 30000),
    devtoolsCheckMs: asNumber(raw.devtoolsCheckMs, DEFAULT_PERFORMANCE_SETTINGS.devtoolsCheckMs, 5000, 60000),
    evidenceCooldownMs: asNumber(raw.evidenceCooldownMs, DEFAULT_PERFORMANCE_SETTINGS.evidenceCooldownMs, 10000, 180000),
    evidenceImageQuality: asNumber(raw.evidenceImageQuality, DEFAULT_PERFORMANCE_SETTINGS.evidenceImageQuality, 0.25, 0.8),
    evidenceMaxWidth: asNumber(raw.evidenceMaxWidth, DEFAULT_PERFORMANCE_SETTINGS.evidenceMaxWidth, 320, 1080),
    audioClipMs: asNumber(raw.audioClipMs, DEFAULT_PERFORMANCE_SETTINGS.audioClipMs, 2000, 10000),
    requireScreenShareDesktop: typeof raw.requireScreenShareDesktop === 'boolean' ? raw.requireScreenShareDesktop : DEFAULT_PERFORMANCE_SETTINGS.requireScreenShareDesktop,
    allowReducedProctoringOnIOS: typeof raw.allowReducedProctoringOnIOS === 'boolean' ? raw.allowReducedProctoringOnIOS : DEFAULT_PERFORMANCE_SETTINGS.allowReducedProctoringOnIOS,
    maxDataUrlChars: asNumber(raw.maxDataUrlChars, DEFAULT_PERFORMANCE_SETTINGS.maxDataUrlChars, 500000, 3000000)
  };

  if (output.contestLoadMode) {
    output.answerSaveDelayMs = Math.max(output.answerSaveDelayMs, 1200);
    output.periodicSnapshotMs = Math.max(output.periodicSnapshotMs, 30000);
    output.cameraCheckMs = Math.max(output.cameraCheckMs, 10000);
    output.devtoolsCheckMs = Math.max(output.devtoolsCheckMs, 8000);
    output.evidenceCooldownMs = Math.max(output.evidenceCooldownMs, 25000);
    output.evidenceMaxWidth = Math.min(output.evidenceMaxWidth, 720);
    output.evidenceImageQuality = Math.min(output.evidenceImageQuality, 0.55);
  }

  return output;
}
