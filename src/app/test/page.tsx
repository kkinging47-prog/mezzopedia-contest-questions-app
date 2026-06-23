'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Option = { id: string; text: string; imageUrl?: string };
type Question = { id: string; text: string; imageUrl?: string; options: Option[]; points: number };
type SessionPayload = {
  session: { id: string; startedAt: string; expiresAt: string; answers: Record<string, string>; participant: { name: string; usercode: string; category: string } };
  questions: Question[];
};

type Severity = 'low' | 'medium' | 'high' | 'critical';

export default function TestPage() {
  const router = useRouter();
  const [data, setData] = useState<SessionPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [submitting, setSubmitting] = useState(false);
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

  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const screenCaptureSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;

  function captureFromVideo(video: HTMLVideoElement | null) {
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return '';
    const canvas = document.createElement('canvas');
    const maxWidth = 720;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.55);
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

  const logViolation = useCallback(async (eventType: string, severity: Severity, details: Record<string, unknown> = {}, captureEvidence = false) => {
    const now = Date.now();
    const key = `${eventType}:${severity}`;
    const throttleMs = eventType === 'PERIODIC_PROCTORING_SNAPSHOT' ? 9000 : 3000;
    if (loggedRef.current[key] && now - loggedRef.current[key] < throttleMs) return;
    loggedRef.current[key] = now;
    if (eventType !== 'PERIODIC_PROCTORING_SNAPSHOT') {
      setViolations(v => v + 1);
      setProctorWarning(`Warning recorded: ${eventType.replaceAll('_', ' ')}`);
      window.setTimeout(() => setProctorWarning(''), 6500);
    }

    const bodyDetails: Record<string, unknown> = { ...details, questionIndex: current + 1 };
    if (captureEvidence) {
      const faceSnapshotDataUrl = captureFromVideo(videoRef.current);
      const screenSnapshotDataUrl = captureFromVideo(screenVideoRef.current);
      if (faceSnapshotDataUrl) bodyDetails.faceSnapshotDataUrl = faceSnapshotDataUrl;
      if (screenSnapshotDataUrl) bodyDetails.screenSnapshotDataUrl = screenSnapshotDataUrl;
    }

    await fetch('/api/session/proctoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType, severity, details: bodyDetails })
    }).catch(() => null);
  }, [current]);

  useEffect(() => {
    fetch('/api/session')
      .then(async res => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load test.');
        setData(json);
        setAnswers(json.session.answers || {});
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!data) return;
    const tick = () => {
      const seconds = Math.max(0, Math.floor((new Date(data.session.expiresAt).getTime() - Date.now()) / 1000));
      setTimeLeft(seconds);
      if (seconds === 0) submit(true);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!proctorAccepted) return;

    const onVisibility = () => {
      if (document.hidden) logViolation('TAB_SWITCH_OR_APP_BACKGROUND', 'high', { documentHidden: true }, true);
    };
    const onBlur = () => logViolation('WINDOW_BLUR_OR_EXTERNAL_APP_FOCUS', 'medium', {}, true);
    const onPaste = (event: ClipboardEvent) => { event.preventDefault(); logViolation('PASTE_BLOCKED', 'high', {}, true); };
    const onCopy = (event: ClipboardEvent) => { event.preventDefault(); logViolation('COPY_OR_CUT_BLOCKED', 'medium', {}, true); };
    const onContext = (event: MouseEvent) => { event.preventDefault(); logViolation('RIGHT_CLICK_BLOCKED', 'medium', {}, true); };
    const onKey = (event: KeyboardEvent) => {
      const shortcut = (event.ctrlKey || event.metaKey) && ['c', 'v', 'x', 'u', 'f', 'p', 's', 'a', 'r'].includes(event.key.toLowerCase());
      const blocked = event.key === 'F12' || event.key === 'PrintScreen' || shortcut || (event.altKey && event.key === 'Tab');
      if (blocked) { event.preventDefault(); logViolation('BLOCKED_KEYBOARD_SHORTCUT_OR_SCREENSHOT_ATTEMPT', event.key === 'F12' || event.key === 'PrintScreen' ? 'critical' : 'high', { key: event.key, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey }, true); }
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement && !isIOS) logViolation('FULLSCREEN_EXITED', 'critical', {}, true);
    };
    const onResize = () => {
      if (window.innerWidth < screen.width * 0.65 || window.innerHeight < screen.height * 0.55) {
        logViolation('POSSIBLE_SPLIT_SCREEN_OR_SMALL_WINDOW', 'high', { innerWidth: window.innerWidth, innerHeight: window.innerHeight, screenWidth: screen.width, screenHeight: screen.height }, true);
      }
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
      if (window.outerWidth - window.innerWidth > threshold || window.outerHeight - window.innerHeight > threshold) {
        logViolation('POSSIBLE_DEVTOOLS_OR_SCREEN_OVERLAY_PANEL', 'critical', { innerWidth: window.innerWidth, outerWidth: window.outerWidth, innerHeight: window.innerHeight, outerHeight: window.outerHeight }, true);
      }
    }, 5000);

    const snapshotTimer = window.setInterval(() => {
      logViolation('PERIODIC_PROCTORING_SNAPSHOT', 'low', { reason: '10-second screen and face evidence capture' }, true);
    }, 10000);

    const cameraTimer = window.setInterval(() => {
      const brightness = getFaceBrightness();
      const videoTrack = mediaStreamRef.current?.getVideoTracks()[0];
      if (videoTrack && (videoTrack.muted || videoTrack.readyState !== 'live')) {
        logViolation('CAMERA_STOPPED_OR_BLOCKED', 'critical', { readyState: videoTrack.readyState, muted: videoTrack.muted }, true);
      } else if (brightness !== null && brightness < 12) {
        logViolation('CAMERA_COVERED_OR_TOO_DARK', 'critical', { brightness: Math.round(brightness) }, true);
      }
    }, 5000);

    const audioTimer = window.setInterval(() => {
      const analyser = analyserRef.current;
      if (!analyser) return;
      const buffer = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (const value of buffer) {
        const centered = value - 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / buffer.length);
      if (rms > 22) logViolation('SURROUNDING_AUDIO_SPIKE_DETECTED', 'medium', { rms: Math.round(rms) }, true);
    }, 2200);

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
  }, [logViolation, proctorAccepted, isIOS]);


  useEffect(() => {
    if (!proctorAccepted) return;
    if (videoRef.current && mediaStreamRef.current) {
      videoRef.current.srcObject = mediaStreamRef.current;
      videoRef.current.play().catch(() => null);
    }
    if (screenVideoRef.current && screenStreamRef.current) {
      screenVideoRef.current.srcObject = screenStreamRef.current;
      screenVideoRef.current.play().catch(() => null);
    }
  }, [proctorAccepted]);

  useEffect(() => () => {
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
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
    } catch {
      logViolation('AUDIO_MONITOR_SETUP_FAILED', 'medium');
    }
  }

  function setupSpeechMonitoring() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      logViolation('SPEECH_RECOGNITION_NOT_SUPPORTED', 'low');
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results).map((r: any) => r[0]?.transcript || '').join(' ').toLowerCase();
        const suspiciousWords = ['a', 'b', 'c', 'd', 'one', 'two', 'three', 'four', 'option', 'answer', 'choose'];
        if (suspiciousWords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(transcript))) {
          logViolation('POSSIBLE_ANSWER_SPOKEN_OR_EXTERNAL_VOICE', 'high', { transcript: transcript.slice(-220) }, true);
        }
      };
      recognition.onerror = () => logViolation('SPEECH_RECOGNITION_ERROR', 'low');
      recognition.start();
    } catch {
      logViolation('SPEECH_RECOGNITION_START_FAILED', 'low');
    }
  }

  async function startProctoring() {
    setProctorError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => null);
      }
      setCameraReady(stream.getVideoTracks().length > 0);
      setAudioReady(stream.getAudioTracks().length > 0);
      setupAudioMonitoring(stream);
      setupSpeechMonitoring();

      if (screenCaptureSupported && !isIOS) {
        try {
          const screenStream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
          screenStreamRef.current = screenStream;
          if (screenVideoRef.current) {
            screenVideoRef.current.srcObject = screenStream;
            await screenVideoRef.current.play().catch(() => null);
          }
          setScreenReady(true);
          screenStream.getVideoTracks()[0]?.addEventListener('ended', () => {
            setScreenReady(false);
            logViolation('SCREEN_SHARE_STOPPED', 'critical', {}, true);
          });
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
        body: JSON.stringify({ eventType: 'PROCTORING_STARTED', severity: 'low', details: { camera: true, audio: true, screen: screenCaptureSupported && !isIOS, isIOS } })
      }).catch(() => null);

      if (!isIOS && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen().catch(() => logViolation('FULLSCREEN_DECLINED', 'high', {}, true));
      }
    } catch {
      setProctorError('Camera and microphone permission are required before the test can continue. Please allow them and try again.');
      logViolation('CAMERA_OR_MICROPHONE_DENIED', 'critical');
    }
  }

  async function selectAnswer(optionId: string) {
    if (!question) return;
    setAnswers(prev => ({ ...prev, [question.id]: optionId }));
    await fetch('/api/session/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: question.id, optionId })
    }).catch(() => setError('Network issue: answer saved locally, but could not sync yet.'));
  }

  async function submit(force = false) {
    if (!data || submitting) return;
    const unanswered = data.questions.filter(q => !answers[q.id]).length;
    if (unanswered && !force) {
      setError(`You still have ${unanswered} unanswered question(s). Use the question numbers to complete them.`);
      return;
    }
    setSubmitting(true);
    setError('');
    await logViolation('TEST_SUBMISSION_ATTEMPT', 'low', { force, unanswered }, true);
    const res = await fetch('/api/session/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force })
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(json.error || 'Could not submit test.');
      return;
    }
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
            <p>This test monitors camera/microphone permission, repeat logins, tab switching, copy/paste, keyboard shortcuts, fullscreen exits, small/split windows, suspicious browser panels, surrounding audio spikes, possible spoken answer clues, covered camera, and 10-second face/screen evidence snapshots where your browser allows it.</p>
            <div className="alert alert-info">Camera and microphone access are required. On laptops/desktops, screen sharing is also required so the app can record screen evidence. Browsers cannot secretly detect every external app or overlay unless screen sharing permission is granted.</div>
            {isIOS && <div className="alert alert-info">iPhone/iPad users are not forced into fullscreen and may not support screen sharing. Camera and microphone are still required.</div>}
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
        <div className="small">📹 Camera: {cameraReady ? 'Active' : 'Required'} • 🎤 Audio: {audioReady ? 'Active' : 'Required'} • 🖥️ Screen: {screenReady || isIOS || !screenCaptureSupported ? 'Active/Not supported' : 'Required'}</div>
        <div className="small">Violations logged: {violations}</div>
      </div>

      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>{data?.session.participant.name}</strong>
          <span className="badge">Time Left: {formatTime(timeLeft)}</span>
        </nav>

        <div className="card card-pad">
          <div className="flex between wrap">
            <div>
              <span className="badge">{data?.session.participant.category}</span>
              <h2 style={{ marginTop: 10 }}>Question {current + 1} of {data?.questions.length}</h2>
            </div>
            <div style={{ minWidth: 220 }}>
              <div className="small muted">Answered: {answeredCount}/{data?.questions.length}</div>
              <div className="progress"><div style={{ width: `${progress}%` }} /></div>
            </div>
          </div>

          {proctorWarning && <div className="alert alert-error no-print">{proctorWarning}</div>}
          {error && <div className="alert alert-error no-print">{error}</div>}

          {question && (
            <section>
              <p style={{ fontSize: '1.25rem', fontWeight: 800, whiteSpace: 'pre-wrap' }}>{question.text}</p>
              {question.imageUrl && <img src={question.imageUrl} alt="Question" className="question-image" />}
              <div>
                {question.options.map(option => (
                  <button
                    type="button"
                    key={option.id}
                    className={`option ${answers[question.id] === option.id ? 'selected' : ''}`}
                    onClick={() => selectAnswer(option.id)}
                  >
                    <strong>{option.id}.</strong> <span style={{ whiteSpace: 'pre-wrap' }}>{option.text}</span>
                    {option.imageUrl && <div><img src={option.imageUrl} alt={`Option ${option.id}`} className="question-image" style={{ maxHeight: 120 }} /></div>}
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="flex between wrap no-print" style={{ marginTop: 20 }}>
            <button className="btn btn-light" disabled={current === 0} onClick={() => setCurrent(v => Math.max(0, v - 1))}>Previous</button>
            <div className="flex wrap" style={{ justifyContent: 'center' }}>
              {data?.questions.map((q, index) => (
                <button key={q.id} className={`tab ${index === current ? 'active' : ''}`} onClick={() => setCurrent(index)} style={{ background: answers[q.id] && index !== current ? '#0f8a4b' : undefined, color: answers[q.id] && index !== current ? 'white' : undefined }}>{index + 1}</button>
              ))}
            </div>
            {current + 1 < (data?.questions.length || 0) ? (
              <button className="btn btn-primary" onClick={() => setCurrent(v => v + 1)}>Next</button>
            ) : (
              <button className="btn btn-success" disabled={submitting} onClick={() => submit(false)}>{submitting ? 'Submitting...' : 'Submit Test'}</button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
