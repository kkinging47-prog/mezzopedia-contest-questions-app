-- Resumable test/session support
-- Safe to run more than once. It does not delete existing answers or sessions.

alter table public.contest_sessions
  add column if not exists accumulated_time_seconds integer not null default 0;

alter table public.contest_sessions
  add column if not exists active_started_at timestamptz;

alter table public.contest_sessions
  add column if not exists last_seen_at timestamptz;

alter table public.contest_sessions
  add column if not exists current_question_index integer not null default 0;

update public.contest_sessions
set accumulated_time_seconds = coalesce(time_used_seconds, accumulated_time_seconds, 0)
where status = 'completed'
  and time_used_seconds is not null;

update public.contest_sessions
set active_started_at = coalesce(active_started_at, now()),
    last_seen_at = coalesce(last_seen_at, now())
where status = 'in_progress';

create index if not exists idx_contest_sessions_resume_active
  on public.contest_sessions(participant_id, contest_stage, status, updated_at desc);

create index if not exists idx_contest_sessions_last_seen
  on public.contest_sessions(status, last_seen_at desc);
