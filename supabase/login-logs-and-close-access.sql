-- Safe migration for Mezzopedia login logs and automatic access closure after completion.

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
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.participant_login_events enable row level security;
create index if not exists participant_login_events_created_idx on public.participant_login_events(created_at desc);

create or replace function public.close_participant_after_completed_session()
returns trigger
language plpgsql
security definer
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

drop trigger if exists trg_close_participant_after_completed_session on public.contest_sessions;
create trigger trg_close_participant_after_completed_session
after update of status on public.contest_sessions
for each row
execute function public.close_participant_after_completed_session();
