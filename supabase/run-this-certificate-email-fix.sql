-- Mezzopedia certificate/email support
-- Run in Supabase SQL Editor before sending certificates by email.

alter table public.participants
  add column if not exists email text;

create index if not exists idx_participants_email
  on public.participants(email);

insert into public.app_config (key, value)
values (
  'certificateSettings',
  '{"templateUrl":"","certificateDate":"2026-12-01","nameX":148,"nameY":92,"categoryX":148,"categoryY":112,"dateX":148,"dateY":132,"nameFontSize":26,"categoryFontSize":16,"dateFontSize":14,"textColor":"#001f4d"}'::jsonb
)
on conflict (key) do nothing;
