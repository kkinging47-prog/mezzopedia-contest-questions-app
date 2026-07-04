-- Performance and stability upgrade for high-traffic contest days.
-- Safe to run more than once. It does not delete questions, participants or results.

insert into public.app_config (key, value)
values (
  'runtimeSettings',
  '{"contestLoadMode":true,"answerSaveDelayMs":2000,"snapshotMs":60000,"cameraCheckMs":20000,"audioCheckMs":6000,"panelCheckMs":15000,"cooldownMs":45000,"imageQuality":0.38,"maxImageWidth":480,"audioClipMs":2500,"requireDesktopScreen":true,"reducedMobileMode":true}'::jsonb
)
on conflict (key) do update set value = excluded.value, updated_at = now();

create index if not exists idx_participants_usercode on public.participants(usercode);
create index if not exists idx_participants_stage_active on public.participants(contest_stage, is_active);
create index if not exists idx_participants_category_stage on public.participants(category, contest_stage);
create index if not exists idx_questions_category_phase_active on public.questions(category, phase, is_active);
create index if not exists idx_sessions_participant_status_stage on public.contest_sessions(participant_id, status, contest_stage);
create index if not exists idx_sessions_status_updated on public.contest_sessions(status, updated_at desc);
create index if not exists idx_sessions_completed_stage_score_time on public.contest_sessions(contest_stage, status, score desc, time_used_seconds asc);
create index if not exists idx_proctoring_events_session_created on public.proctoring_events(session_id, created_at desc);
create index if not exists idx_proctoring_events_participant_created on public.proctoring_events(participant_id, created_at desc);
create index if not exists idx_login_events_usercode_created on public.participant_login_events(usercode, created_at desc);

comment on index idx_sessions_completed_stage_score_time is 'Speeds ranking by stage, highest score and fastest time.';
