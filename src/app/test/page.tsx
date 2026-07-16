'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_RUNTIME_SETTINGS } from '@/lib/runtimeSettings';

const DEFAULT_TEST_DURATION_SECONDS = 70 * 60;
const HEARTBEAT_MS = 10000;

type Option = { id: string; text: string; imageUrl?: string };
type Question = { id: string; text: string; imageUrl?: string; options: Option[]; points: number };
type SessionPayload = {
  session: {
    id: string;
    startedAt: string;
    expiresAt: string;
    answers: Record<string, string>;
    timeUsedSeconds?: number;
    durationSeconds?: number;
    currentQuestionIndex?: number;
    participant: { name: string; usercode: string; category: string };
  };
  questions: Question[];
};

type Severity = 'low' | 'medium' | 'high' | 'critical';
type CaptureEvidence = boolean | { images?: boolean; audio?: boolean };
type RuntimeSettings = typeof DEFAULT_RUNTIME_SETTINGS;

function normalizeRuntimeSettings(value: unknown): RuntimeSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const d = DEFAULT_RUNTIME_SETTINGS;
  const num = (key: keyof RuntimeSettings, min: number, max: number) => {
    const v = Number(raw[key]);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d[key] as number;
  };
  const bool = (key: keyof RuntimeSettings) => typeof raw[key] === 'boolean' ? raw[key] as boolean : d[key] as boolean;
  return {
    contestLoadMode: bool('contestLoadMode'),
    answerSaveDelayMs: num('answerSaveDelayMs', 500, 5000),
    snapshotMs: num('snapshotMs', 15000, 120000),
    cameraCheckMs: num('cameraCheckMs', 5000, 60000),
    audioCheckMs: num('audioCheckMs', 2000, 30000),
    panelCheckMs: num('panelCheckMs', 5000, 60000),
    cooldownMs: num('cooldownMs', 10000, 180000),
    imageQuality: Math.min(0.75, Math.max(0.25, Number(raw.imageQuality) || d.imageQuality)),
    maxImageWidth: num('maxImageWidth', 320, 900),
    audioClipMs: num('audioClipMs', 1500, 10000),
    requireDesktopScreen: bool('requireDesktopScreen'),
    reducedMobileMode: bool('reducedMobileMode')
  };
}

function boundedIndex(index: number, count: number) {
  if (!count) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(index || 0)));
}

function firstUnansweredIndex(questions: Question[], answers: Record<string, string>, fallback: number) {
  const unanswered = questions.findIndex(q => !answers[q.id]);
  return boundedIndex(unanswered >= 0 ? unanswered : fallback, questions.length);
}

export default function TestPage() {
  const router = useRouter();
  const [data, setData] = useState<SessionPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeSettings>(DEFAULT_RUNTIME_SETTINGS);
  const [proctorAccepted, setProctorAccepted] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [screenReady, setScreenReady] = useState(false);
  const [proctorError, setProctorError] = useState('');
  const [proctorWarning, setProctorWarning] = useState('');
  const [violations, setViolations] = useState(0);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const loggedRef = useRef<Record<string, number>>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioRecordingRef = useRef(false);
  const pendingAnswersRef = useRef<Record<string, string>>({});
  const answerTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const currentRef = useRef(0);
  const sessionLoadedAtRef = useRef(Date.now());

  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPad|iPhone|iPod/.test(navigator.userAgent);
  const screenCaptureSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;

  function captureFromVideo(video: HTMLVideoElement | null) {
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return '';
    const canvas = document.createElement('canvas');
    const maxWidth = runtime.maxImageWidth;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', runtime.imageQuality);
  }

  function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  }

  async function recordAudioEvidenceClip(durationMs = runtime.audioClipMs) {
    const audioTracks = mediaStreamRef.current?.getAudioTracks() || [];
    if (!audioTracks.length || typeof MediaRecorder === 'undefined' || audioRecordingRef.current) return '';

    audioRecordingRef.current = true;
    return new Promise<string>((resolve) => {
      const chunks: BlobPart[] = [];
      let settled = false;
      const finish = async (recorder?: MediaRecorder) => {
        if (settled) return;
        settled = true;
        audioRecordingRef.current = false;
        try {
          if (!chunks.length) return resolve('');
          const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
          resolve(await blobToDataUrl(blob));
        } catch { resolve(''); }
      };

      try {
        const audioStream = new MediaStream(audioTracks);
        const options = typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm') ? { mimeType: 'audio/webm' } : undefined;
        const recorder = new MediaRecorder(audioStream, options);
        recorder.ondataavailable = event => { if (event.data && event.data.size > 0) chunks.push(event.data); };
        recorder.onerror = () => finish(recorder);
        recorder.onstop = () => finish(recorder);
        recorder.start();
        window.setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, durationMs);
      } catch {
        audioRecordingRef.current = false;
        resolve('');
      }
    });
  }

  function getFaceBrightness() {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) total += (data[i] + data[i + 1] + data[i + 2]) / 3;
    return total / (data.length / 4);
  }

  async function saveProgress(useBeacon = false) {
    if (!data) return true;
    const pending = { ...pendingAnswersRef.current };
    const body = JSON.stringify({ currentQuestionIndex: currentRef.current, answers: pending });

    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const sent = navigator.sendBeacon('/api/session/progress', new Blob([body], { type: 'application/json' }));
      return sent;
    }

    const res = await fetch('/api/session/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    }).catch(() => null);

    if (res?.ok) {
      pendingAnswersRef.current = {};
      return true;
    }
    return false;
  }

  async function flushPendingAnswers() {
    const pending = { ...pendingAnswersRef.current };
    if (!Object.keys(pending).length && data) {
      await saveProgress().catch(() => null);
      return true;
    }
    if (!Object.keys(pending).length) return true;
    pendingAnswersRef.current = {};
    setSyncing(true);
    const res = await fetch('/api/session/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: pending, currentQuestionIndex: currentRef.current })
    }).catch(() => null);
    setSyncing(false);
    if (!res || !res.ok) {
      pendingAnswersRef.current = { ...pending, ...pendingAnswersRef.current };
      setError('Network issue: your answer is kept on this device and will retry shortly.');
      return false;
    }
    return true;
  }

  function scheduleAnswerSync() {
    if (answerTimerRef.current) window.clearTimeout(answerTimerRef.current);
    answerTimerRef.current = window.setTimeout(() => {
      flushPendingAnswers().catch(() => setError('Network issue: answer sync will retry.'));
    }, runtime.answerSaveDelayMs);
  }

  function goToQuestion(index: number) {
    const next = boundedIndex(index, data?.questions.length || 0);
    currentRef.current = next;
    setCurrent(next);
    saveProgress().catch(() => null);
  }

  const logViolation = useCallback(async (eventType: string, severity: Severity, details: Record<string, unknown> = {}, captureEvidence: CaptureEvidence = false) => {
    const now = Date.now();
    const key = `${eventType}:${severity}`;
    const throttleMs = eventType === 'PERIODIC_PROCTORING_SNAPSHOT' ? Math.max(15000, runtime.snapshotMs - 1000) : (captureEvidence ? runtime.cooldownMs : 3000);
    if (loggedRef.current[key] && now - loggedRef.current[key] < throttleMs) return;
    loggedRef.current[key] = now;
    if (eventType !== 'PERIODIC_PROCTORING_SNAPSHOT') {
      setViolations(v => v + 1);
      setProctorWarning(`Warning recorded: ${eventType.replaceAll('_', ' ')}`);
      window.setTimeout(() => setProctorWarning(''), 6500);
    }

    const captureImages = typeof captureEvidence === 'boolean' ? captureEvidence : !!captureEvidence.images;
    const captureAudio = typeof captureEvidence === 'object' ? !!captureEvidence.audio : false;
    const bodyDetails: Record<string, unknown> = { ...details, questionIndex: currentRef.current + 1 };

    if (captureImages) {
      const faceSnapshotDataUrl = captureFromVideo(videoRef.current);
      const screenSnapshotDataUrl = captureFromVideo(screenVideoRef.current);
      if (faceSnapshotDataUrl) bodyDetails.faceSnapshotDataUrl = faceSnapshotDataUrl;
      if (screenSnapshotDataUrl) bodyDetails.screenSnapshotDataUrl = screenSnapshotDataUrl;
    }
    if (captureAudio) {
      const audioEvidenceDataUrl = await recordAudioEvidenceClip();
      if (audioEvidenceDataUrl) bodyDetails.audioEvidenceDataUrl = audioEvidenceDataUrl;
    }

    await fetch('/api/session/proctoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType, severity, details: bodyDetails })
    }).catch(() => null);
  }, [runtime]);

  useEffect(() => {
    fetch('/api/stability')
      .then(res => res.json())
      .then(json => setRuntime(normalizeRuntimeSettings(json?.settings)))
      .catch(() => null);
  }, []);

  useEffect(() => {
    fetch('/api/session')
      .then(async res => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load test.');
        const loadedAnswers = json.session.answers || {};
        const resumeIndex = firstUnansweredIndex(json.questions || [], loadedAnswers, Number(json.session.currentQuestionIndex || 0));
        sessionLoadedAtRef.current = Date.now();
        currentRef.current = resumeIndex;
        setData(json);
        setAnswers(loadedAnswers);
        setCurrent(resumeIndex);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!data) return;
    const tick = () => {
      const duration = Number(data.session.durationSeconds || DEFAULT_TEST_DURATION_SECONDS);
      const usedBeforeLoad = Number(data.session.timeUsedSeconds || 0);
      const activeSeconds = Math.floor((Date.now() - sessionLoadedAtRef.current) / 1000);
      const seconds = Math.max(0, duration - usedBeforeLoad - activeSeconds);
      setTimeLeft(seconds);
      if (seconds === 0) submit(true);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!data) return;
    heartbeatTimerRef.current = window.setInterval(() => {
      saveProgress().catch(() => null);
    }, HEARTBEAT_MS);

    const onPageHide = () => { saveProgress(true).catch(() => null); };
    const onVisibility = () => { if (document.hidden) saveProgress(true).catch(() => null); };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!proctorAccepted) return;
    const onVisibility = () => { if (document.hidden) logViolation('TAB_SWITCH_OR_APP_BACKGROUND', 'high', { documentHidden: true }, true); };
    const onBlur = () => logViolation('WINDOW_BLUR_OR_EXTERNAL_APP_FOCUS', 'medium', {}, true);
    const onPaste = (event: ClipboardEvent) => { event.preventDefault(); logViolation('PASTE_BLOCKED', 'high', {}, true); };
    const onCopy = (event: ClipboardEvent) => { event.preventDefault(); logViolation('COPY_OR_CUT_BLOCKED', 'medium', {}, true); };
    const onContext = (event: MouseEvent) => { event.preventDefault(); logViolation('RIGHT_CLICK_BLOCKED', 'medium', {}, true); };
    const onKey = (event: KeyboardEvent) => {
      const shortcut = (event.ctrlKey || event.metaKey) && ['c', 'v', 'x', 'u', 'f', 'p', 's', 'a', 'r'].includes(event.key.toLowerCase());
      const blocked = event.key === 'F12' || event.key === 'PrintScreen' || shortcut || (event.altKey && event.key === 'Tab');
      if (blocked) { event.preventDefault(); logViolation('BLOCKED_KEYBOARD_SHORTCUT_OR_SCREENSHOT_ATTEMPT', event.key === 'F12' || event.key === 'PrintScreen' ? 'critical' : 'high', { key: event.key, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey }, true); }
    };
    const onFullscreen = () => { if (!document.fullscreenElement && !isIOS) logViolation('FULLSCREEN_EXITED', 'critical', {}, true); };
    const onResize = () => {
      if (!isMobile && (window.innerWidth < screen.width * 0.65 || window.innerHeight < screen.height * 0.55)) logViolation('POSSIBLE_SPLIT_SCREEN_OR_SMALL_WINDOW', 'high', { innerWidth: window.innerWidth, innerHeight: window.innerHeight, screenWidth: screen.width, screenHeight: screen.height }, true);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('paste', onPaste);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('contextmenu', onContext);
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    window.addEventListener('resize', onResize);

    const devtoolsTimer = window.setInterval(() => {
      const threshold = 160;
      if (!isMobile && (window.outerWidth - window.innerWidth > threshold || window.outerHeight - window.innerHeight > threshold)) logViolation('POSSIBLE_DEVTOOLS_OR_SCREEN_OVERLAY_PANEL', 'critical', { innerWidth: window.innerWidth, outerWidth: window.outerWidth, innerHeight: window.innerHeight, outerHeight: window.outerHeight }, true);
    }, runtime.panelCheckMs);

    const snapshotTimer = window.setInterval(() => logViolation('PERIODIC_PROCTORING_SNAPSHOT', 'low', { reason: `${Math.round(runtime.snapshotMs / 1000)}-second face/screen check` }, true), runtime.snapshotMs);

    const cameraTimer = window.setInterval(() => {
      const brightness = getFaceBrightness();
      const videoTrack = mediaStreamRef.current?.getVideoTracks()[0];
      if (videoTrack && (videoTrack.muted || videoTrack.readyState !== 'live')) logViolation('CAMERA_STOPPED_OR_BLOCKED', 'critical', { readyState: videoTrack.readyState, muted: videoTrack.muted }, true);
      else if (brightness !== null && brightness < 12) logViolation('CAMERA_COVERED_OR_TOO_DARK', 'critical', { brightness: Math.round(brightness) }, true);
    }, runtime.cameraCheckMs);

    const audioTimer = window.setInterval(() => {
      const analyser = analyserRef.current;
      if (!analyser) return;
      const buffer = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (const value of buffer) { const centered = value - 128; sum += centered * centered; }
      const rms = Math.sqrt(sum / buffer.length);
      if (rms > 22) logViolation('SURROUNDING_AUDIO_SPIKE_DETECTED', 'medium', { rms: Math.round(rms), explanation: 'The microphone detected a loud sound near the candidate. A short audio clip is saved for review when supported.' }, { images: true, audio: true });
    }, runtime.audioCheckMs);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('contextmenu', onContext);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('resize', onResize);
      window.clearInterval(devtoolsTimer);
      window.clearInterval(snapshotTimer);
      window.clearInterval(cameraTimer);
      window.clearInterval(audioTimer);
    };
  }, [logViolation, proctorAccepted, isIOS, isMobile, runtime]);

  useEffect(() => {
    if (!proctorAccepted) return;
    if (videoRef.current && mediaStreamRef.current) { videoRef.current.srcObject = mediaStreamRef.current; videoRef.current.play().catch(() => null); }
    if (screenVideoRef.current && screenStreamRef.current) { screenVideoRef.current.srcObject = screenStreamRef.current; screenVideoRef.current.play().catch(() => null); }
  }, [proctorAccepted]);

  useEffect(() => () => {
    if (answerTimerRef.current) window.clearTimeout(answerTimerRef.current);
    if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    screenStreamRef.current?.getTracks().forEach(track => track.stop());
    audioContextRef.current?.close().catch(() => null);
  }, []);

  const question = data?.questions[current];
  const answeredCount = useMemo(() => data ? data.questions.filter(q => answers[q.id]).length : 0, [data, answers]);
  const progress = data ? Math.round((answeredCount / data.questions.length) * 100) : 0;

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function setupAudioMonitoring(stream: MediaStream) {
    try {
      const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
    } catch { logViolation('AUDIO_MONITOR_SETUP_FAILED', 'medium'); }
  }

  function setupSpeechMonitoring() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { logViolation('SPEECH_RECOGNITION_NOT_SUPPORTED', 'low'); return; }
    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results).map((r: any) => r[0]?.transcript || '').join(' ').toLowerCase();
        const suspiciousWords = ['a', 'b', 'c', 'd', 'one', 'two', 'three', 'four', 'option', 'answer', 'choose'];
        if (suspiciousWords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(transcript))) logViolation('POSSIBLE_ANSWER_SPOKEN_OR_EXTERNAL_VOICE', 'high', { transcript: transcript.slice(-220), explanation: 'Speech recognition detected possible answer words or outside voice near the candidate.' }, { images: true, audio: true });
      };
      recognition.onerror = () => logViolation('SPEECH_RECOGNITION_ERROR', 'low');
      recognition.start();
    } catch { logViolation('SPEECH_RECOGNITION_START_FAILED', 'low'); }
  }

  async function startProctoring() {
    setProctorError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
      mediaStreamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => null); }
      setCameraReady(stream.getVideoTracks().length > 0);
      setAudioReady(stream.getAudioTracks().length > 0);
      setupAudioMonitoring(stream);
      setupSpeechMonitoring();

      if (screenCaptureSupported && !isMobile && !isIOS && runtime.requireDesktopScreen) {
        try {
          const screenStream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
          screenStreamRef.current = screenStream;
          if (screenVideoRef.current) { screenVideoRef.current.srcObject = screenStream; await screenVideoRef.current.play().catch(() => null); }
          setScreenReady(true);
          screenStream.getVideoTracks()[0]?.addEventListener('ended', () => { setScreenReady(false); logViolation('SCREEN_SHARE_STOPPED', 'critical', {}, true); });
        } catch {
          setProctorError('Screen sharing is required on laptops/desktops for the national contest. Please allow screen sharing and try again.');
          await logViolation('SCREEN_SHARE_DECLINED', 'critical', {}, true);
          return;
        }
      }

      setProctorAccepted(true);
      await fetch('/api/session/proctoring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'PROCTORING_STARTED', severity: 'low', details: { camera: true, audio: true, screen: screenCaptureSupported && !isMobile && !isIOS, isIOS, isMobile, runtime } })
      }).catch(() => null);

      if (!isIOS && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen().catch(() => logViolation('FULLSCREEN_DECLINED', 'high', {}, true));
    } catch {
      setProctorError('Camera and microphone permission are required before the test can continue. Please allow them and try again.');
      logViolation('CAMERA_OR_MICROPHONE_DENIED', 'critical');
    }
  }

  async function selectAnswer(optionId: string) {
    if (!question) return;
    setAnswers(prev => ({ ...prev, [question.id]: optionId }));
    pendingAnswersRef.current[question.id] = optionId;
    setError('');
    scheduleAnswerSync();
  }

  async function submit(force = false) {
    if (!data || submitting) return;
    const unanswered = data.questions.filter(q => !answers[q.id]).length;
    if (unanswered && !force) { setError(`You still have ${unanswered} unanswered question(s). Use the question numbers to complete them.`); return; }
    setSubmitting(true);
    setError('');
    if (answerTimerRef.current) window.clearTimeout(answerTimerRef.current);
    await flushPendingAnswers();
    await logViolation('TEST_SUBMISSION_ATTEMPT', 'low', { force, unanswered }, true);
    const res = await fetch('/api/session/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }) });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) { setError(json.error || 'Could not submit test.'); return; }
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    screenStreamRef.current?.getTracks().forEach(track => track.stop());
    router.push('/results');
  }

  if (loading) return <main className="math-bg centered"><div className="card card-pad">Loading test...</div></main>;
  if (error && !data) return <main className="math-bg centered"><div className="card card-pad"><div className="alert alert-error">{error}</div><a className="btn btn-primary" href="/sign-in">Back to Sign In</a></div></main>;

  if (!proctorAccepted) {
    return (
      <main className="math-bg centered">
        <video ref={videoRef} muted playsInline style={{ width: 1, height: 1, opacity: 0, position: 'fixed', left: -9999 }} />
        <video ref={screenVideoRef} muted playsInline style={{ width: 1, height: 1, opacity: 0, position: 'fixed', left: -9999 }} />
        <div className="container" style={{ maxWidth: 820 }}>
          <div className="card card-pad">
            <span className="badge">AI Proctored Test</span>
            <h1 style={{ marginTop: 14 }}>Before You Continue</h1>
            <p>This test monitors camera/microphone permission, repeat logins, tab switching, copy/paste, keyboard shortcuts, fullscreen exits, small/split windows, suspicious browser panels, surrounding audio spikes, possible spoken answer clues, covered camera, and periodic face/screen snapshots where your browser allows it.</p>
            <div className="alert alert-info">Your answers, current question and used minutes are saved regularly. If your network drops or the page closes, sign in again with the same code to continue from where you stopped.</div>
            <div className="alert alert-info">Camera and microphone access are required. On laptops/desktops, screen sharing is also required. Suspicious audio events save only a short review clip.</div>
            {isIOS && <div className="alert alert-info">iPhone/iPad users are not forced into fullscreen and may not support screen sharing. Camera and microphone are still required. Use Safari/Chrome updated to the latest version.</div>}
            {proctorError && <div className="alert alert-error">{proctorError}</div>}
            <button className="btn btn-primary" onClick={startProctoring}>Allow Camera/Mic/Screen and Begin</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="math-bg" style={{ paddingBottom: 40 }}>
      <video ref={videoRef} muted playsInline style={{ width: 1, height: 1, opacity: 0, position: 'fixed', left: -9999 }} />
      <video ref={screenVideoRef} muted playsInline style={{ width: 1, height: 1, opacity: 0, position: 'fixed', left: -9999 }} />
      <div className="proctor no-print">
        <strong>Proctoring Active</strong>
        <div className="small">📹 Camera: {cameraReady ? 'Active' : 'Required'} • 🎤 Audio: {audioReady ? 'Active' : 'Required'} • 🖥️ Screen: {screenReady || isIOS || isMobile || !screenCaptureSupported ? 'Active/Not supported' : 'Required'}</div>
        <div className="small">Violations logged: {violations}. {syncing ? 'Saving answer...' : 'Answers/current question/time saved regularly.'}</div>
      </div>

      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>{data?.session.participant.name}</strong>
          <span className="badge">Time Left: {formatTime(timeLeft)}</span>
        </nav>

        <div className="card card-pad">
          <div className="flex between wrap">
            <div><span className="badge">{data?.session.participant.category}</span><h2 style={{ marginTop: 10 }}>Question {current + 1} of {data?.questions.length}</h2></div>
            <div style={{ minWidth: 220 }}><div className="small muted">Answered: {answeredCount}/{data?.questions.length}</div><div className="progress"><div style={{ width: `${progress}%` }} /></div></div>
          </div>

          {proctorWarning && <div className="alert alert-error no-print">{proctorWarning}</div>}
          {error && <div className="alert alert-error no-print">{error}</div>}

          {question && (
            <section>
              <p className="test-question-text">{question.text}</p>
              {question.imageUrl && <img src={question.imageUrl} alt="Question" className="question-image" />}
              <div>{question.options.map(option => (
                <button type="button" key={option.id} className={`option ${answers[question.id] === option.id ? 'selected' : ''}`} onClick={() => selectAnswer(option.id)}>
                  <strong>{option.id}.</strong> <span style={{ whiteSpace: 'pre-wrap' }}>{option.text}</span>
                  {option.imageUrl && <div><img src={option.imageUrl} alt={`Option ${option.id}`} className="question-image" style={{ maxHeight: 120 }} /></div>}
                </button>
              ))}</div>
            </section>
          )}

          <div className="flex between wrap no-print sticky-test-actions" style={{ marginTop: 20 }}>
            <button className="btn btn-light" disabled={current === 0} onClick={() => goToQuestion(current - 1)}>Previous</button>
            <div className="flex wrap question-nav" style={{ justifyContent: 'center' }}>{data?.questions.map((q, index) => (
              <button key={q.id} className={`tab ${index === current ? 'active' : ''}`} onClick={() => goToQuestion(index)} style={{ background: answers[q.id] && index !== current ? '#0f8a4b' : undefined, color: answers[q.id] && index !== current ? 'white' : undefined }}>{index + 1}</button>
            ))}</div>
            {current + 1 < (data?.questions.length || 0) ? <button className="btn btn-primary" onClick={() => goToQuestion(current + 1)}>Next</button> : <button className="btn btn-success" disabled={submitting} onClick={() => submit(false)}>{submitting ? 'Submitting...' : 'Submit Test'}</button>}
          </div>
        </div>
      </div>
    </main>
  );
}
