export const DEFAULT_RUNTIME_SETTINGS = {
  contestLoadMode: true,
  // Save answers in short batches instead of one request per click.
  answerSaveDelayMs: 2000,
  // Space heavy evidence uploads to protect Supabase/Vercel during high traffic.
  snapshotMs: 60000,
  cameraCheckMs: 20000,
  audioCheckMs: 6000,
  panelCheckMs: 15000,
  cooldownMs: 45000,
  // Clearer evidence screenshots for admin review while still keeping files small enough for contest use.
  imageQuality: 0.58,
  maxImageWidth: 840,
  audioClipMs: 2500,
  // Require screen sharing on desktop/laptop where supported. Mobile browsers are handled more lightly.
  requireDesktopScreen: true,
  reducedMobileMode: true
};
