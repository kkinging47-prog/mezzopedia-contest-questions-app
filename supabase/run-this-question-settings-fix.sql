-- Question bank settings for Mezzopedia
-- Safe to run more than once. It does not delete existing questions, participants or results.

insert into public.app_config (key, value)
values (
  'questionCountSettings',
  '{
    "Stage 1":{"Primary 5":10,"Primary 6":10,"JHS 1":10,"JHS 2":10,"JHS 3":10,"SHS":10,"Adults":10},
    "Stage 2":{"Primary 5":10,"Primary 6":10,"JHS 1":10,"JHS 2":10,"JHS 3":10,"SHS":10,"Adults":10},
    "Stage 3":{"Primary 5":10,"Primary 6":10,"JHS 1":10,"JHS 2":10,"JHS 3":10,"SHS":10,"Adults":10}
  }'::jsonb
)
on conflict (key) do nothing;

create index if not exists idx_questions_category_phase_active
  on public.questions(category, phase, is_active);

create index if not exists idx_sessions_category_stage_status
  on public.contest_sessions(category, contest_stage, status);

create index if not exists idx_sessions_question_order
  on public.contest_sessions using gin(question_order);
