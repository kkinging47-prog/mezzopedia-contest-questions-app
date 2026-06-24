-- Mezzopedia stage-control database fix
-- Run this in Supabase SQL Editor if you see:
-- column contest_sessions.contest_stage does not exist
--
-- This migration is safe for existing data. It does not delete questions,
-- participants, results, or proctoring records.

alter table public.participants
  add column if not exists contest_stage text not null default 'Stage 1';

alter table public.contest_sessions
  add column if not exists contest_stage text not null default 'Stage 1';

alter table public.contest_sessions
  add column if not exists active_login_token text;

alter table public.contest_sessions
  add column if not exists active_user_agent text;

alter table public.contest_sessions
  add column if not exists last_reauth_at timestamptz;

alter table public.proctoring_events
  add column if not exists evidence jsonb not null default '{}'::jsonb;

-- Keep old sessions aligned with the participant's current stage where possible.
update public.contest_sessions cs
set contest_stage = coalesce(p.contest_stage, cs.contest_stage, 'Stage 1')
from public.participants p
where cs.participant_id = p.id
  and (cs.contest_stage is null or cs.contest_stage = 'Stage 1');

create index if not exists idx_contest_sessions_stage_status
  on public.contest_sessions(contest_stage, status);

insert into public.app_config (key, value)
values (
  'stageSettings',
  '{"Stage 1":{"isOpen":true,"note":"Initial online stage"},"Stage 2":{"isOpen":false,"note":"Open after Stage 1 qualification"},"Stage 3":{"isOpen":false,"note":"Open after Stage 2 qualification"}}'::jsonb
)
on conflict (key) do update set
  value = excluded.value,
  updated_at = now();

-- Ensure each new test session is stamped with the participant's currently assigned stage.
create or replace function public.set_session_stage_from_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_stage text;
begin
  select contest_stage into resolved_stage
  from public.participants
  where id = new.participant_id;

  new.contest_stage := coalesce(resolved_stage, 'Stage 1');
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_set_session_stage_from_participant'
  ) then
    create trigger trg_set_session_stage_from_participant
    before insert on public.contest_sessions
    for each row
    execute function public.set_session_stage_from_participant();
  end if;
end;
$$;

-- Close a participant's current access automatically after test completion
-- so the same code cannot immediately retake that stage.
create or replace function public.close_participant_after_completed_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and (old.status is distinct from new.status) then
    update public.participants
       set is_active = false,
           updated_at = now()
     where id = new.participant_id;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_close_participant_after_completed_session'
  ) then
    create trigger trg_close_participant_after_completed_session
    after update of status on public.contest_sessions
    for each row
    execute function public.close_participant_after_completed_session();
  end if;
end;
$$;
