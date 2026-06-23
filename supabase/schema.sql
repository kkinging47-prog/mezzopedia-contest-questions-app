-- Mezzopedia National Mathematics Contest database schema
-- Run this in Supabase SQL Editor before deploying the Vercel app.

create extension if not exists pgcrypto;

create table if not exists public.app_config (
  key text primary key,
  value jsonb not null default '""'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null,
  usercode text not null,
  password_hash text not null,
  payment_status text not null default 'unpaid',
  contest_stage text not null default 'Stage 1',
  is_active boolean not null default true,
  login_count integer not null default 0,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, usercode)
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  phase text not null default 'Stage 1',
  question_text text not null,
  question_image_url text,
  options jsonb not null,
  correct_option_id text not null,
  explanation text,
  points numeric not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contest_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  category text not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'expired', 'cancelled')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  question_order uuid[] not null default '{}',
  answers jsonb not null default '{}'::jsonb,
  answer_breakdown jsonb,
  score numeric not null default 0,
  max_score numeric not null default 0,
  total_questions integer not null default 0,
  time_used_seconds integer not null default 0,
  proctoring_summary jsonb not null default '{}'::jsonb,
  active_login_token text,
  active_user_agent text,
  last_reauth_at timestamptz
);

create unique index if not exists one_in_progress_session_per_participant
  on public.contest_sessions(participant_id)
  where status = 'in_progress';

create table if not exists public.proctoring_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.contest_sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  event_type text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  details jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now()
);

create table if not exists public.participant_login_events (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  session_id uuid references public.contest_sessions(id) on delete cascade,
  usercode text not null,
  category text not null,
  contest_stage text,
  event_type text not null default 'LOGIN',
  login_token text,
  user_agent text,
  ip_address text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.app_config (key, value) values
  ('welcomeTitle', '"Welcome to the Mezzopedia National Mathematics Contest"'),
  ('welcomeSubtitle', '"Ghana’s mathematics champions start here."'),
  ('welcomeBody', '"Read the instructions carefully, sign in with your unique code, and complete the test within the allowed time."'),
  ('bannerImageUrl', '""'),
  ('certificateTemplateUrl', '""'),
  ('activePhase', '"Stage 1"'),
  ('registrationDeadline', '"2026-07-25"')
on conflict (key) do nothing;

-- Optional public storage bucket for uploaded contest images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contest-assets', 'contest-assets', true, 5242880, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

-- Lock direct browser access. The app uses server-side API routes with the Supabase service role key.
alter table public.app_config enable row level security;
alter table public.participants enable row level security;
alter table public.questions enable row level security;
alter table public.contest_sessions enable row level security;
alter table public.proctoring_events enable row level security;
alter table public.participant_login_events enable row level security;
alter table public.admin_audit_logs enable row level security;

-- No public policies are added intentionally. Keep the service role key only in Vercel server env variables.


-- Migration helpers for existing Supabase projects already created with an older version.
alter table public.participants add column if not exists contest_stage text not null default 'Stage 1';
alter table public.contest_sessions add column if not exists active_login_token text;
alter table public.contest_sessions add column if not exists active_user_agent text;
alter table public.contest_sessions add column if not exists last_reauth_at timestamptz;
alter table public.proctoring_events add column if not exists evidence jsonb not null default '{}'::jsonb;
