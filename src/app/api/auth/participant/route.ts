import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { COOKIE_NAMES, QUESTION_COUNT_OPTIONS, TEST_DURATION_MINUTES } from '@/lib/constants';
import { setSecureCookie, signToken, verifyPassword } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, normalizeCategory, shuffle } from '@/lib/utils';

type StageSettings = Record<string, { isOpen?: boolean }>;
type QuestionCountSettings = Record<string, Record<string, number>>;

function parseConfigRows(rows: any[] | null | undefined) {
  const config: Record<string, any> = {};
  for (const row of rows || []) config[row.key] = row.value;
  return config;
}

function isStageOpen(stageSettings: StageSettings, stage: string) {
  if (!stageSettings || !stageSettings[stage]) return stage === 'Stage 1';
  return Boolean(stageSettings[stage]?.isOpen);
}

function questionLimitFor(settings: QuestionCountSettings, stage: string, category: string) {
  const raw = Number(settings?.[stage]?.[category]);
  return (QUESTION_COUNT_OPTIONS as readonly number[]).includes(raw) ? raw : 10;
}

function signature(ids: string[]) {
  return ids.join('|');
}

function setSignature(ids: string[]) {
  return [...ids].sort().join('|');
}

async function pickUniqueQuestionOrder(questionIds: string[], requestedCount: number, category: string, stage: string) {
  const count = Math.min(Math.max(1, requestedCount), questionIds.length);

  const { data: previous } = await supabaseAdmin
    .from('contest_sessions')
    .select('question_order')
    .eq('category', category)
    .eq('contest_stage', stage)
    .in('status', ['in_progress', 'completed', 'expired'])
    .limit(2500);

  const previousOrders = new Set<string>();
  const previousSets = new Set<string>();
  for (const row of previous || []) {
    const order = Array.isArray(row.question_order) ? row.question_order.map(String) : [];
    if (order.length) {
      previousOrders.add(signature(order));
      previousSets.add(setSignature(order));
    }
  }

  let best = shuffle(questionIds).slice(0, count);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = shuffle(questionIds).slice(0, count);
    const orderKey = signature(candidate);
    const setKey = setSignature(candidate);
    if (!previousOrders.has(orderKey) && !previousSets.has(setKey)) return candidate;
    best = candidate;
  }

  // If the bank is too small for completely unique sets, still return a fresh shuffled order.
  return best;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const usercode = String(body.usercode || '').trim();
  const password = String(body.password || '');
  const category = normalizeCategory(String(body.category || ''));
  const enteredName = String(body.name || '').trim();
  const userAgent = request.headers.get('user-agent') || '';

  if (!usercode || !password || !category) {
    return jsonError('Enter your category, usercode and password.');
  }

  const { data: participant, error } = await supabaseAdmin
    .from('participants')
    .select('*')
    .ilike('usercode', usercode)
    .eq('category', category)
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  if (!participant) return jsonError('Invalid code, password or category.', 401);

  const passwordOk = await verifyPassword(password, participant.password_hash);
  if (!passwordOk) return jsonError('Invalid code, password or category.', 401);

  const stage = participant.contest_stage || 'Stage 1';
  const { data: configRows } = await supabaseAdmin
    .from('app_config')
    .select('key,value')
    .in('key', ['stageSettings', 'questionCountSettings']);
  const config = parseConfigRows(configRows);
  const stageSettings = (config.stageSettings || {}) as StageSettings;
  const questionCountSettings = (config.questionCountSettings || {}) as QuestionCountSettings;

  if (!isStageOpen(stageSettings, stage)) {
    await supabaseAdmin.from('participant_login_events').insert({
      participant_id: participant.id,
      usercode: participant.usercode,
      category: participant.category,
      contest_stage: stage,
      event_type: 'LOGIN_BLOCKED_STAGE_CLOSED',
      user_agent: userAgent,
      details: { message: `${stage} is closed. Candidate was not allowed to start/resume.` }
    }).then(() => null);
    return jsonError(`${stage} is currently closed. Please wait for the contest administrator to open it.`, 403);
  }

  if (enteredName && enteredName.toLowerCase() !== String(participant.name || '').toLowerCase()) {
    await supabaseAdmin.from('admin_audit_logs').insert({
      action: 'NAME_MISMATCH_ON_SIGNIN',
      entity_type: 'participant',
      entity_id: participant.id,
      details: { enteredName, registeredName: participant.name }
    });
  }

  const { data: completed } = await supabaseAdmin
    .from('contest_sessions')
    .select('id, score, total_questions, submitted_at')
    .eq('participant_id', participant.id)
    .eq('contest_stage', stage)
    .eq('status', 'completed')
    .maybeSingle();

  if (completed) {
    return jsonError(`This code has already completed ${stage} and has been closed. Use the Results page to view your result.`, 403);
  }

  if (!participant.is_active) return jsonError('This code is closed and cannot be used to start a test. Contact the contest administrator if this is a mistake.', 403);

  let { data: session, error: sessionError } = await supabaseAdmin
    .from('contest_sessions')
    .select('*')
    .eq('participant_id', participant.id)
    .eq('contest_stage', stage)
    .eq('status', 'in_progress')
    .maybeSingle();

  if (sessionError) return jsonError(sessionError.message, 500);

  let loginType = 'LOGIN_NEW_SESSION';

  if (!session) {
    let questionQuery = supabaseAdmin
      .from('questions')
      .select('id')
      .eq('category', category)
      .eq('is_active', true);

    if (stage) questionQuery = questionQuery.eq('phase', stage);

    let { data: questions, error: qError } = await questionQuery;
    if (qError) return jsonError(qError.message, 500);

    if (!questions || questions.length === 0) {
      const fallback = await supabaseAdmin
        .from('questions')
        .select('id')
        .eq('category', category)
        .eq('is_active', true);
      questions = fallback.data || [];
      if (fallback.error) return jsonError(fallback.error.message, 500);
    }

    if (!questions || questions.length === 0) return jsonError('No active questions have been uploaded for this category yet.', 404);

    const requestedCount = questionLimitFor(questionCountSettings, stage, category);
    const selected = await pickUniqueQuestionOrder(questions.map(q => q.id), requestedCount, category, stage);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TEST_DURATION_MINUTES * 60 * 1000);

    const { data: created, error: createError } = await supabaseAdmin
      .from('contest_sessions')
      .insert({
        participant_id: participant.id,
        category,
        contest_stage: stage,
        status: 'in_progress',
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        question_order: selected,
        answers: {},
        total_questions: selected.length
      })
      .select('*')
      .single();

    if (createError) return jsonError(createError.message, 500);
    session = created;
  } else {
    loginType = 'LOGIN_RESUME_EXISTING_SESSION';
    const reshuffled = shuffle(session.question_order || []);
    const { data: updatedSession, error: reorderError } = await supabaseAdmin
      .from('contest_sessions')
      .update({ question_order: reshuffled, updated_at: new Date().toISOString() })
      .eq('id', session.id)
      .select('*')
      .single();
    if (!reorderError && updatedSession) session = updatedSession;
  }

  const previousLogins = Number(participant.login_count || 0);
  const loginToken = randomUUID();

  await supabaseAdmin
    .from('participants')
    .update({ last_login_at: new Date().toISOString(), login_count: previousLogins + 1 })
    .eq('id', participant.id);

  await supabaseAdmin
    .from('contest_sessions')
    .update({ active_login_token: loginToken, active_user_agent: userAgent, last_reauth_at: new Date().toISOString() })
    .eq('id', session.id);

  await supabaseAdmin.from('participant_login_events').insert({
    participant_id: participant.id,
    session_id: session.id,
    usercode: participant.usercode,
    category: participant.category,
    contest_stage: stage,
    event_type: previousLogins > 0 ? 'MULTIPLE_OR_REPEAT_LOGIN' : loginType,
    login_token: loginToken,
    user_agent: userAgent,
    details: { previousLogins, latestLoginInvalidatesOlderBrowsers: true, questionCount: session.total_questions }
  }).then(() => null);

  if (previousLogins > 0) {
    await supabaseAdmin.from('proctoring_events').insert({
      session_id: session.id,
      participant_id: participant.id,
      event_type: 'MULTIPLE_OR_REPEAT_USERCODE_LOGIN',
      severity: 'high',
      details: { previousLogins, message: 'The same usercode logged in again. Older browser sessions were invalidated.' },
      user_agent: userAgent
    }).then(() => null);
  }

  const token = await signToken({ type: 'participant', sessionId: session.id, participantId: participant.id, loginToken }, TEST_DURATION_MINUTES * 60 + 60 * 24);
  const response = NextResponse.json({
    success: true,
    participant: { name: participant.name, category: participant.category, usercode: participant.usercode, contestStage: stage },
    session: { id: session.id, status: session.status, totalQuestions: session.total_questions }
  });
  setSecureCookie(response, COOKIE_NAMES.participant, token, TEST_DURATION_MINUTES * 60 + 60 * 24);
  return response;
}
