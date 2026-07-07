-- Bulk question upload support
-- Safe to run more than once. It does not delete existing questions.

alter table public.questions
  add column if not exists topic text;

alter table public.questions
  add column if not exists source_question_no text;

create index if not exists idx_questions_topic
  on public.questions(topic);

create index if not exists idx_questions_source_question_no
  on public.questions(source_question_no);
