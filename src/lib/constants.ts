export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Mezzopedia National Mathematics Contest';

export const DEFAULT_CATEGORIES = [
  'Primary 5',
  'Primary 6',
  'JHS 1',
  'JHS 2',
  'JHS 3',
  'SHS',
  'Adults'
];

export const FINAL_TRIAL_STAGE = 'Final Trial';
export const CONTEST_STAGES = [FINAL_TRIAL_STAGE, 'Stage 1', 'Stage 2', 'Stage 3'] as const;
export const MAIN_CONTEST_STAGES = ['Stage 1', 'Stage 2', 'Stage 3'] as const;
export const PAYMENT_STATUSES = ['paid', 'pending', 'unpaid'] as const;
export const QUESTION_COUNT_OPTIONS = [10,20,30,40,50,60,70,80,90,100] as const;

export const TEST_DURATION_MINUTES = 70;
export const QUESTIONS_PER_TEST = 10;

export const COOKIE_NAMES = {
  admin: 'mezzopedia_admin_token',
  participant: 'mezzopedia_participant_token'
} as const;

export type ContestStatus = 'not_started' | 'in_progress' | 'completed' | 'expired';