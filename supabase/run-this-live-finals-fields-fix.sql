-- Optional fields for Live Finals finalist lists.
-- Run this in Supabase SQL Editor if you want the admin finalist export
-- to include class, location, region and school from participant records.

alter table public.participants
  add column if not exists class text,
  add column if not exists location text,
  add column if not exists region text,
  add column if not exists school text;

create index if not exists idx_participants_contest_stage on public.participants(contest_stage);
create index if not exists idx_participants_region on public.participants(region);
create index if not exists idx_participants_school on public.participants(school);
