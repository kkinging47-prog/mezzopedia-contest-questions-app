import { CONTEST_STAGES, LIVE_FINALS_STAGE } from '@/lib/constants';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyParticipantPassword } from '@/lib/auth';
import { jsonError, normalizeCategory, normalizeContestStage, percentage } from '@/lib/utils';
import { activeElapsedSeconds, publicAnswers } from '@/lib/sessionTime';
import { certificateDateForStage } from '@/lib/certificateDate';

type StageName = (typeof CONTEST_STAGES)[number];
const SUMMARY_STAGES = ['Stage 1', 'Stage 2', 'Stage 3'] as const;

function stageIndex(stage: string) {
  return CONTEST_STAGES.indexOf(stage as StageName);
}

function optionText(options: any[], optionId: string) {
  const match = (options || []).find(option => String(option.id) === String(optionId));
  if (!match) return '';
  return match.text || match.imageUrl || '';
}

function submittedTime(value?: string) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function sessionTimeUsed(session: any) {
  return activeElapsedSeconds(session, session?.submitted_at ? new Date(session.submitted_at) : new Date());
}

function bestResultSession(a: any, b: any) {
  const aSubmitted = submittedTime(a?.submitted_at) > 0;
  const bSubmitted = submittedTime(b?.submitted_at) > 0;
  if (aSubmitted !== bSubmitted) return aSubmitted ? -1 : 1;

  const aCompleted = a?.status === 'completed';
  const bCompleted = b?.status === 'completed';
  if (aCompleted !== bCompleted) return aCompleted ? -1 : 1;

  const scoreDiff = Number(b?.score || 0) - Number(a?.score || 0);
  if (scoreDiff) return scoreDiff;

  const timeDiff = sessionTimeUsed(a) - sessionTimeUsed(b);
  if (timeDiff) return timeDiff;

  return submittedTime(b?.submitted_at) - submittedTime(a?.submitted_at);
}

function displaySessionCompare(a: any, b: any) {
  const stageDiff = stageIndex(normalizeContestStage(b?.contest_stage || 'Stage 1')) - stageIndex(normalizeContestStage(a?.contest_stage || 'Stage 1'));
  if (stageDiff) return stageDiff;
  return bestResultSession(a, b);
}

function promotionFor(sessionStageInput: unknown, currentStageInput: unknown) {
  const fromStage = normalizeContestStage(sessionStageInput || 'Stage 1');
  const currentStage = normalizeContestStage(currentStageInput || fromStage);
  const fromIndex = stageIndex(fromStage);
  const currentIndex = stageIndex(currentStage);
  const isPromoted = currentIndex > fromIndex;

  return {
    isPromoted,
    fromStage,
    currentStage,
    promotedTo: isPromoted ? currentStage : ''
  };
}

function participantProfile(participant: any) {
  const pick = (keys: string[], fallback = '') => {
    for (const key of keys) {
      const value = participant?.[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return fallback;
  };

  return {
    name: participant.name,
    usercode: participant.usercode,
    category: participant.category,
    class: pick(['class', 'class_name', 'grade', 'level'], participant.category || ''),
    school: pick(['school', 'school_name', 'institution']),
    location: pick(['location', 'district', 'city', 'town']),
    region: pick(['region']),
    paymentStatus: participant.payment_status,
    currentStage: normalizeContestStage(participant.contest_stage || 'Stage 1')
  };
}

function buildScript(session: any, questionMap: Map<string, any>) {
  const questionIds: string[] = Array.isArray(session?.question_order) ? session.question_order.map(String) : [];
  const answers = publicAnswers(session || {});
  const breakdown = session?.answer_breakdown || {};

  return questionIds.map((id, index) => {
    const q: any = questionMap.get(id);
    if (!q) return null;
    const selectedOptionId = String(answers[id] || breakdown[id]?.selected || '');
    const correctOptionId = String(q.correct_option_id || breakdown[id]?.correct || '');
    const isCorrect = Boolean(selectedOptionId && selectedOptionId === correctOptionId);
    const points = Number(q.points || breakdown[id]?.points || 1);
    return {
      number: index + 1,
      questionId: id,
      category: q.category,
      stage: q.phase || session.contest_stage || '',
      questionText: q.question_text,
      questionImageUrl: q.question_image_url || '',
      options: q.options || [],
      selectedOptionId,
      selectedAnswer: optionText(q.options || [], selectedOptionId),
      correctOptionId,
      correctAnswer: optionText(q.options || [], correctOptionId),
      isCorrect,
      points,
      pointsAwarded: isCorrect ? points : 0,
      explanation: q.explanation || ''
    };
  }).filter(Boolean);
}

function stageResult(stage: string, session: any, questionMap: Map<string, any>) {
  if (!session) return null;
  const maxScore = Number(session.max_score || session.total_questions || 0);
  const score = Number(session.score || 0);
  const script = buildScript(session, questionMap);
  return {
    stage,
    status: session.status,
    score,
    maxScore,
    totalQuestions: Number(session.total_questions || script.length || 0),
    percentage: percentage(score, maxScore),
    timeUsedSeconds: sessionTimeUsed(session),
    submittedAt: session.submitted_at || '',
    proctoringSummary: session.proctoring_summary || {},
    script
  };
}

function makeOverallSummary(stageResults: any[]) {
  const completed = stageResults.filter(Boolean);
  const totalScore = completed.reduce((sum, stage) => sum + Number(stage.score || 0), 0);
  const totalMaxScore = completed.reduce((sum, stage) => sum + Number(stage.maxScore || 0), 0);
  const totalTimeSeconds = completed.reduce((sum, stage) => sum + Number(stage.timeUsedSeconds || 0), 0);
  const allItems = completed.flatMap(stage => (stage.script || []).map((item: any) => ({ ...item, stage: stage.stage })));
  const correct = allItems.filter(item => item.isCorrect).length;
  const wrong = allItems.filter(item => item.selectedOptionId && !item.isCorrect).length;
  const unanswered = allItems.filter(item => !item.selectedOptionId).length;
  const weakStages = completed.filter(stage => Number(stage.percentage || 0) < 50).map(stage => stage.stage);
  const strongStages = completed.filter(stage => Number(stage.percentage || 0) >= 70).map(stage => stage.stage);
  const wrongByStage = completed.map(stage => ({
    stage: stage.stage,
    wrongQuestionNumbers: (stage.script || []).filter((item: any) => !item.isCorrect).map((item: any) => item.number),
    correct: (stage.script || []).filter((item: any) => item.isCorrect).length,
    wrong: (stage.script || []).filter((item: any) => !item.isCorrect).length
  }));

  const first = completed[0]?.percentage || 0;
  const last = completed[completed.length - 1]?.percentage || 0;
  const trend = completed.length >= 2
    ? last > first ? 'improving' : last < first ? 'declining' : 'stable'
    : 'single-stage';

  let analysis = '';
  const averagePercentage = percentage(totalScore, totalMaxScore);
  if (!completed.length) {
    analysis = 'No submitted stage result was found for this candidate.';
  } else if (averagePercentage >= 80) {
    analysis = 'The candidate showed excellent consistency across the online stages, with strong accuracy and good readiness for higher-level competition.';
  } else if (averagePercentage >= 65) {
    analysis = 'The candidate performed well overall, but the wrong-question pattern should be reviewed carefully to strengthen weak areas before the live stage.';
  } else if (averagePercentage >= 50) {
    analysis = 'The candidate showed fair performance with some correct understanding, but needs more work on accuracy, speed and repeated practice of missed concepts.';
  } else {
    analysis = 'The candidate struggled across the submitted stages and needs focused revision on the questions answered wrongly or left unanswered.';
  }

  if (trend === 'improving') analysis += ' The stage trend is positive because the later-stage percentage is higher than the earlier-stage percentage.';
  if (trend === 'declining') analysis += ' The stage trend needs attention because the later-stage percentage is lower than the earlier-stage percentage.';
  if (wrong || unanswered) analysis += ` Review the ${wrong} wrong and ${unanswered} unanswered question(s) shown in the answer scripts.`;

  return {
    completedStages: completed.length,
    totalScore,
    totalMaxScore,
    averageScore: completed.length ? Number((totalScore / completed.length).toFixed(2)) : 0,
    averagePercentage,
    totalTimeSeconds,
    averageTimeSeconds: completed.length ? Math.round(totalTimeSeconds / completed.length) : 0,
    correctQuestions: correct,
    wrongQuestions: wrong,
    unansweredQuestions: unanswered,
    strongStages,
    weakStages,
    wrongByStage,
    trend,
    analysis
  };
}

export async function POST(request: Request) {
  const { category, usercode, password } = await request.json().catch(() => ({}));
  const code = String(usercode || '').trim();
  const cat = normalizeCategory(String(category || ''));
  const pass = String(password || '');

  if (!cat || !code || !pass) return jsonError('Enter your category, usercode and password.');

  const { data: participant, error } = await supabaseAdmin
    .from('participants')
    .select('*')
    .eq('category', cat)
    .ilike('usercode', code)
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  if (!participant) return jsonError('Invalid result lookup details.', 401);

  const ok = await verifyParticipantPassword(pass, participant.password_hash);
  if (!ok) return jsonError('Invalid result lookup details.', 401);

  const { data: sessions, error: sError } = await supabaseAdmin
    .from('contest_sessions')
    .select('*')
    .eq('participant_id', participant.id)
    .in('status', ['completed', 'expired'])
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false })
    .limit(50);

  if (sError) return jsonError(sError.message, 500);
  if (!sessions?.length) return jsonError('No completed result found for this code.', 404);

  const stageSessions: Record<string, any> = {};
  for (const stage of SUMMARY_STAGES) {
    const stageRows = (sessions || []).filter((session: any) => normalizeContestStage(session.contest_stage || '') === stage);
    stageSessions[stage] = stageRows.length ? [...stageRows].sort(bestResultSession)[0] : null;
  }

  const displaySession = [...sessions].sort(displaySessionCompare)[0];
  const questionIds = Array.from(new Set(Object.values(stageSessions).flatMap((session: any) => Array.isArray(session?.question_order) ? session.question_order.map(String) : []))).filter(Boolean);
  const questionMap = new Map<string, any>();

  if (questionIds.length) {
    const { data: questions, error: qError } = await supabaseAdmin
      .from('questions')
      .select('id,category,phase,question_text,question_image_url,options,correct_option_id,points,explanation')
      .in('id', questionIds);
    if (qError) return jsonError(qError.message, 500);
    for (const question of questions || []) questionMap.set(String((question as any).id), question);
  }

  const stageResults = SUMMARY_STAGES.map(stage => stageResult(stage, stageSessions[stage], questionMap));
  const timeUsedSeconds = sessionTimeUsed(displaySession);
  const promotion = promotionFor(displaySession.contest_stage || '', participant.contest_stage || displaySession.contest_stage || '');

  const { data: configRows } = await supabaseAdmin
    .from('app_config')
    .select('key,value')
    .in('key', ['stageSettings', 'certificateSettings']);
  const config: Record<string, any> = {};
  for (const row of configRows || []) config[row.key] = row.value;
  const certificateDate = certificateDateForStage(config.stageSettings, displaySession.contest_stage || '', config.certificateSettings?.certificateDate || displaySession.submitted_at || '');

  const displayMaxScore = Number(displaySession.max_score || displaySession.total_questions || 0);
  const displayScore = Number(displaySession.score || 0);
  const overallSummary = makeOverallSummary(stageResults.filter(Boolean));

  return Response.json({
    success: true,
    result: {
      participant: participantProfile(participant),
      stage: displaySession.contest_stage || '',
      currentStage: normalizeContestStage(participant.contest_stage || displaySession.contest_stage || 'Stage 1'),
      promotion,
      isLiveFinalist: normalizeContestStage(participant.contest_stage || '') === LIVE_FINALS_STAGE,
      certificateDate,
      status: displaySession.status,
      score: displayScore,
      maxScore: displayMaxScore,
      totalQuestions: displaySession.total_questions || 0,
      percentage: percentage(displayScore, displayMaxScore),
      timeUsedSeconds,
      submittedAt: displaySession.submitted_at,
      proctoringSummary: displaySession.proctoring_summary || {},
      script: buildScript(displaySession, questionMap),
      stageResults,
      overallSummary
    }
  });
}
