'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { CONTEST_STAGES, DEFAULT_CATEGORIES, PAYMENT_STATUSES } from '@/lib/constants';

type Participant = { id: string; name: string; usercode: string; category: string; payment_status: string; contest_stage?: string; is_active: boolean; login_count: number; created_at: string };
type QuestionOption = { id: string; text: string; imageUrl?: string };
type Question = { id: string; category: string; question_text: string; question_image_url?: string; options: QuestionOption[]; correct_option_id: string; points: number; phase: string; is_active: boolean };
type Result = { id: string; name: string; usercode: string; category: string; status?: string; score: number; maxScore: number; totalQuestions: number; percentage: number; timeUsedSeconds: number; submittedAt: string; proctoringSummary: { riskLevel?: string; total?: number; critical?: number; high?: number; byType?: Record<string, number> } };
type Evidence = { faceSnapshotUrl?: string; screenSnapshotUrl?: string; audioEvidenceUrl?: string; faceSnapshotPath?: string; screenSnapshotPath?: string; audioEvidencePath?: string };
type ProctorEvent = { id: string; eventType: string; severity: string; details: Record<string, unknown>; evidence: Evidence; createdAt: string; name: string; usercode: string; category: string; contestStage?: string; ipAddress?: string; userAgent?: string; sessionStatus?: string };
type LoginEvent = { id: string; eventType: string; createdAt: string; name: string; usercode: string; category: string; contestStage?: string; sessionStatus?: string; userAgent?: string; deviceType?: string; browserName?: string; osName?: string; details?: Record<string, unknown> };
type ConfigMap = Record<string, string>;

type QuestionForm = {
  category: string;
  phase: string;
  questionText: string;
  questionImageUrl: string;
  optionA: string;
  optionAImage: string;
  optionB: string;
  optionBImage: string;
  optionC: string;
  optionCImage: string;
  optionD: string;
  optionDImage: string;
  correctOptionId: string;
  points: number;
  isActive: boolean;
};

const emptyQuestionForm = (category = DEFAULT_CATEGORIES[0], phase = 'Stage 1'): QuestionForm => ({
  category,
  phase,
  questionText: '',
  questionImageUrl: '',
  optionA: '',
  optionAImage: '',
  optionB: '',
  optionBImage: '',
  optionC: '',
  optionCImage: '',
  optionD: '',
  optionDImage: '',
  correctOptionId: 'A',
  points: 1,
  isActive: true
});

const SYMBOLS = [
  { label: 'x²', value: '²' },
  { label: 'x³', value: '³' },
  { label: '√', value: '√' },
  { label: '∑', value: '∑' },
  { label: 'π', value: 'π' },
  { label: 'θ', value: 'θ' },
  { label: '×', value: '×' },
  { label: '÷', value: '÷' },
  { label: '≤', value: '≤' },
  { label: '≥', value: '≥' },
  { label: '≠', value: '≠' },
  { label: 'Fraction', value: ' (a)/(b) ' },
  { label: 'Power', value: ' xⁿ ' },
  { label: '½', value: '½' },
  { label: '¼', value: '¼' },
  { label: '¾', value: '¾' }
];

const EVENT_EXPLANATIONS: Record<string, string> = {
  PROCTORING_STARTED: 'Monitoring started. Camera, microphone, and/or screen permission was checked for this candidate.',
  PERIODIC_PROCTORING_SNAPSHOT: 'A regular evidence snapshot was attempted. When permissions allow, face and screen images are saved for review.',
  TAB_SWITCH_OR_APP_BACKGROUND: 'The candidate left the test tab or the browser moved to the background.',
  WINDOW_BLUR: 'The test window lost focus. This may happen when another tab, window, or app is opened.',
  WINDOW_BLUR_OR_EXTERNAL_APP_FOCUS: 'The test window lost focus. This may happen when another tab, window, or app is opened.',
  PASTE_BLOCKED: 'The candidate tried to paste content into the test page. The action was blocked and recorded.',
  COPY_OR_CUT_BLOCKED: 'The candidate tried to copy/cut content from the test page. The action was blocked and recorded.',
  RIGHT_CLICK_BLOCKED: 'The candidate tried to open the right-click menu. The action was blocked and recorded.',
  BLOCKED_KEYBOARD_SHORTCUT_OR_SCREENSHOT_ATTEMPT: 'A restricted keyboard shortcut was pressed, such as copy, paste, print, save, view source, or screenshot-related keys.',
  FULLSCREEN_EXITED: 'The candidate left fullscreen during the test.',
  FULLSCREEN_DECLINED: 'The candidate declined fullscreen mode.',
  POSSIBLE_SPLIT_SCREEN_OR_SMALL_WINDOW: 'The browser window became unusually small, which can indicate split-screen mode or window resizing.',
  POSSIBLE_DEVTOOLS_OR_SCREEN_OVERLAY_PANEL: 'The browser window dimensions suggest developer tools, a side panel, or a screen overlay may be open.',
  CAMERA_STOPPED_OR_BLOCKED: 'The camera stopped, was blocked, or became unavailable during the test.',
  CAMERA_COVERED_OR_TOO_DARK: 'The camera image became very dark, which may mean the camera was covered or the room was too dark.',
  SURROUNDING_AUDIO_SPIKE_DETECTED: 'The microphone detected loud surrounding sound. A short audio clip is saved when the browser supports it.',
  POSSIBLE_ANSWER_SPOKEN_OR_EXTERNAL_VOICE: 'Possible speech or nearby voice was detected. A short audio clip may be available for review.',
  SCREEN_SHARE_STOPPED: 'The candidate stopped screen sharing during the test.',
  SCREEN_SHARE_DECLINED: 'The candidate declined screen sharing on a browser/device where it is supported.',
  CAMERA_OR_MICROPHONE_DENIED: 'The candidate declined camera or microphone permission.',
  TEST_SUBMISSION_ATTEMPT: 'The candidate submitted or attempted to submit the test.'
};

function explain(eventType: string) {
  return EVENT_EXPLANATIONS[eventType] || eventType.replaceAll('_', ' ').toLowerCase();
}

function severityMeaning(severity: string) {
  const s = severity?.toLowerCase?.() || 'low';
  if (s === 'critical') return 'Critical: review immediately before accepting the result.';
  if (s === 'high') return 'High: likely violation or serious risk.';
  if (s === 'medium') return 'Medium: suspicious behaviour that needs context.';
  return 'Low: routine monitoring/information record.';
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('dashboard');

  const [config, setConfig] = useState<ConfigMap>({});
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [proctoringEvents, setProctoringEvents] = useState<ProctorEvent[]>([]);
  const [loginEvents, setLoginEvents] = useState<LoginEvent[]>([]);
  const [message, setMessage] = useState('');

  const [participantForm, setParticipantForm] = useState({ category: DEFAULT_CATEGORIES[0], name: '', usercode: '', password: '', paymentStatus: 'unpaid', contestStage: 'Stage 1' });
  const [csvText, setCsvText] = useState('');
  const [questionForm, setQuestionForm] = useState<QuestionForm>(emptyQuestionForm());
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [resultCategory, setResultCategory] = useState('All');
  const [resultSort, setResultSort] = useState('highestScore');
  const [proctorSearch, setProctorSearch] = useState('');
  const [proctorSeverity, setProctorSeverity] = useState('All');

  const completedCount = useMemo(() => results.filter(r => r.submittedAt).length, [results]);
  const sortedResults = useMemo(() => {
    const filtered = resultCategory === 'All' ? [...results] : results.filter(r => r.category === resultCategory);
    return filtered.sort((a, b) => {
      if (resultSort === 'category') return a.category.localeCompare(b.category) || b.score - a.score || a.timeUsedSeconds - b.timeUsedSeconds;
      if (resultSort === 'fastestTime') return a.timeUsedSeconds - b.timeUsedSeconds || b.score - a.score;
      return b.score - a.score || a.timeUsedSeconds - b.timeUsedSeconds;
    });
  }, [results, resultCategory, resultSort]);

  const filteredProctoringEvents = useMemo(() => {
    const q = proctorSearch.trim().toLowerCase();
    return proctoringEvents.filter(event => {
      const severityOk = proctorSeverity === 'All' || event.severity?.toLowerCase() === proctorSeverity.toLowerCase();
      const searchOk = !q || [event.name, event.usercode, event.category, event.eventType, event.contestStage].some(v => String(v || '').toLowerCase().includes(q));
      return severityOk && searchOk;
    });
  }, [proctoringEvents, proctorSearch, proctorSeverity]);

  const proctorCounts = useMemo(() => ({
    total: proctoringEvents.length,
    critical: proctoringEvents.filter(e => e.severity === 'critical').length,
    high: proctoringEvents.filter(e => e.severity === 'high').length,
    audio: proctoringEvents.filter(e => e.evidence?.audioEvidenceUrl).length,
    images: proctoringEvents.filter(e => e.evidence?.faceSnapshotUrl || e.evidence?.screenSnapshotUrl).length
  }), [proctoringEvents]);

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      setAuthenticated(res.ok);
      if (res.ok) loadAll();
    }).finally(() => setChecking(false));
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setError('');
    const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || 'Invalid login.'); return; }
    setPassword('');
    setAuthenticated(true);
    loadAll();
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setEmail('');
    setPassword('');
    setAuthenticated(false);
  }

  async function loadAll() {
    setMessage('Loading latest data...');
    await Promise.all([loadConfig(), loadParticipants(), loadQuestions(), loadResults(), loadProctoringEvents(), loadLoginEvents()]);
    setMessage('');
  }

  async function loadConfig() {
    const publicConfig = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
    setConfig(publicConfig.config || {});
  }
  async function loadParticipants() {
    const json = await fetch('/api/admin/participants').then(r => r.json()).catch(() => ({}));
    setParticipants(json.participants || []);
  }
  async function loadQuestions() {
    const json = await fetch('/api/admin/questions').then(r => r.json()).catch(() => ({}));
    setQuestions(json.questions || []);
  }
  async function loadResults() {
    const json = await fetch('/api/admin/results').then(r => r.json()).catch(() => ({}));
    setResults(json.results || []);
  }
  async function loadProctoringEvents() {
    const json = await fetch('/api/admin/proctoring').then(r => r.json()).catch(() => ({}));
    setProctoringEvents(json.events || []);
  }
  async function loadLoginEvents() {
    const json = await fetch('/api/admin/logins').then(r => r.json()).catch(() => ({}));
    setLoginEvents(json.events || []);
  }

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    const res = await fetch('/api/admin/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) });
    setMessage(res.ok ? 'Welcome page settings saved permanently in Supabase.' : 'Could not save settings.');
  }

  async function uploadImage(file: File | null, folder: string, field: string) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('folder', folder);
    const res = await fetch('/api/admin/upload', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setMessage(json.error || 'Upload failed.'); return; }
    if (field.startsWith('config.')) {
      const key = field.split('.')[1];
      setConfig(prev => ({ ...prev, [key]: json.url }));
    } else {
      setQuestionForm(prev => ({ ...prev, [field]: json.url } as QuestionForm));
    }
    setMessage('Image uploaded and linked. Save the form to keep it permanently.');
  }

  async function addParticipant(event: FormEvent) {
    event.preventDefault();
    const res = await fetch('/api/admin/participants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(participantForm) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setMessage(json.error || 'Could not add participant.'); return; }
    setParticipantForm({ category: DEFAULT_CATEGORIES[0], name: '', usercode: '', password: '', paymentStatus: 'unpaid', contestStage: 'Stage 1' });
    setMessage('Participant saved permanently in Supabase.');
    loadParticipants();
  }

  async function importParticipants() {
    const participants = csvText.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const [category, name, usercode, password, paymentStatus, contestStage] = line.split(',').map(v => v?.trim());
      return { category, name, usercode, password, paymentStatus: paymentStatus || 'unpaid', contestStage: contestStage || 'Stage 1' };
    });
    const res = await fetch('/api/admin/participants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participants }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setMessage(json.error || 'Import failed.'); return; }
    setCsvText('');
    setMessage(`Imported ${json.imported} participant(s).`);
    loadParticipants();
  }

  async function deleteParticipant(id: string) {
    if (!confirm('Delete this participant? This also affects their access.')) return;
    const res = await fetch(`/api/admin/participants/${id}`, { method: 'DELETE' });
    setMessage(res.ok ? 'Participant deleted.' : 'Delete failed.');
    loadParticipants();
  }

  function buildQuestionBody() {
    return {
      category: questionForm.category,
      phase: questionForm.phase,
      questionText: questionForm.questionText,
      questionImageUrl: questionForm.questionImageUrl,
      correctOptionId: questionForm.correctOptionId,
      points: questionForm.points,
      isActive: questionForm.isActive,
      options: [
        { id: 'A', text: questionForm.optionA, imageUrl: questionForm.optionAImage },
        { id: 'B', text: questionForm.optionB, imageUrl: questionForm.optionBImage },
        { id: 'C', text: questionForm.optionC, imageUrl: questionForm.optionCImage },
        { id: 'D', text: questionForm.optionD, imageUrl: questionForm.optionDImage }
      ]
    };
  }

  function validateQuestionForm() {
    const optionTexts = [questionForm.optionA, questionForm.optionB, questionForm.optionC, questionForm.optionD].map(v => v.trim().toLowerCase()).filter(Boolean);
    if (new Set(optionTexts).size !== optionTexts.length) return 'Do not enter the same answer text in more than one option.';
    if (!questionForm.questionText.trim()) return 'Question text is required.';
    if (optionTexts.length < 2) return 'At least two answer options are required.';
    return '';
  }

  async function saveQuestion(event: FormEvent) {
    event.preventDefault();
    const validationError = validateQuestionForm();
    if (validationError) { setMessage(validationError); return; }
    const body = buildQuestionBody();
    const url = editingQuestionId ? `/api/admin/questions/${editingQuestionId}` : '/api/admin/questions';
    const method = editingQuestionId ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setMessage(json.error || 'Could not save question.'); return; }
    const keepCategory = questionForm.category;
    const keepPhase = questionForm.phase;
    setQuestionForm(emptyQuestionForm(keepCategory, keepPhase));
    setEditingQuestionId(null);
    setFileInputKey(v => v + 1);
    setMessage(editingQuestionId ? 'Question updated successfully.' : 'Question saved permanently in Supabase.');
    loadQuestions();
  }

  function editQuestion(question: Question) {
    const option = (id: string) => question.options?.find(o => o.id === id) || { id, text: '', imageUrl: '' };
    setQuestionForm({
      category: question.category,
      phase: question.phase || 'Stage 1',
      questionText: question.question_text,
      questionImageUrl: question.question_image_url || '',
      optionA: option('A').text || '',
      optionAImage: option('A').imageUrl || '',
      optionB: option('B').text || '',
      optionBImage: option('B').imageUrl || '',
      optionC: option('C').text || '',
      optionCImage: option('C').imageUrl || '',
      optionD: option('D').text || '',
      optionDImage: option('D').imageUrl || '',
      correctOptionId: question.correct_option_id || 'A',
      points: Number(question.points || 1),
      isActive: question.is_active
    });
    setEditingQuestionId(question.id);
    setTab('questions');
    setMessage('Editing selected question. Make changes and click Update Question.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEditQuestion() {
    setEditingQuestionId(null);
    setQuestionForm(emptyQuestionForm(questionForm.category, questionForm.phase));
    setFileInputKey(v => v + 1);
  }

  async function deleteQuestion(id: string) {
    if (!confirm('Delete this question?')) return;
    const res = await fetch(`/api/admin/questions/${id}`, { method: 'DELETE' });
    setMessage(res.ok ? 'Question deleted.' : 'Delete failed.');
    loadQuestions();
  }

  function exportResultsExcel() {
    const rows = sortedResults.map(r => ({
      Name: r.name,
      Usercode: r.usercode,
      Category: r.category,
      Score: r.score,
      'Max Score': r.maxScore,
      Percentage: `${r.percentage}%`,
      'Time Used Seconds': r.timeUsedSeconds,
      'Submitted At': r.submittedAt,
      'Proctoring Risk': r.proctoringSummary?.riskLevel || 'LOW',
      'Proctoring Events': r.proctoringSummary?.total || 0
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Results');
    XLSX.writeFile(wb, 'mezzopedia-results.xlsx');
  }

  function exportParticipantsExcel() {
    const rows = participants.map(p => ({ Name: p.name, Usercode: p.usercode, Category: p.category, Payment: p.payment_status, Stage: p.contest_stage || 'Stage 1', Active: p.is_active, Logins: p.login_count }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Participants');
    XLSX.writeFile(wb, 'mezzopedia-participants.xlsx');
  }

  function generateCertificate(result: Result) {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFillColor(246, 248, 251); doc.rect(0, 0, 297, 210, 'F');
    doc.setDrawColor(23, 78, 166); doc.setLineWidth(2); doc.rect(12, 12, 273, 186);
    doc.setFontSize(26); doc.text('Certificate of Participation', 148, 48, { align: 'center' });
    doc.setFontSize(14); doc.text('This certifies that', 148, 72, { align: 'center' });
    doc.setFontSize(30); doc.text(result.name, 148, 92, { align: 'center' });
    doc.setFontSize(14); doc.text(`participated in the Mezzopedia National Mathematics Contest (${result.category})`, 148, 112, { align: 'center' });
    doc.text(`Score: ${result.score}/${result.maxScore} (${result.percentage}%)`, 148, 128, { align: 'center' });
    doc.text(`Date: ${result.submittedAt ? new Date(result.submittedAt).toLocaleDateString() : new Date().toLocaleDateString()}`, 148, 144, { align: 'center' });
    doc.save(`certificate-${result.usercode}.pdf`);
  }

  if (checking) return <main className="math-bg centered"><div className="card card-pad">Checking admin session...</div></main>;

  if (!authenticated) {
    return <main className="math-bg centered"><div className="container" style={{ maxWidth: 560 }}><form className="card card-pad" onSubmit={login} autoComplete="off"><a className="badge" href="/">← Home</a><h1 style={{ fontSize: '2.4rem' }}>Admin Login</h1><p className="muted">Use the secure admin credentials you set in environment variables.</p>{error && <div className="alert alert-error">{error}</div>}<label><span className="label">Email</span><input className="input" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" /></label><label><span className="label">Password</span><div className="flex"><input className="input" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /><button type="button" className="btn btn-light" onClick={() => setShowPassword(v => !v)}>{showPassword ? 'Hide' : 'View'}</button></div></label><button className="btn btn-primary" style={{ width: '100%', marginTop: 18 }}>Login</button></form></div></main>;
  }

  const tabs = ['dashboard','participants','questions','results','certificates','proctoring','loginLogs','security'];

  return (
    <main className="math-bg" style={{ paddingBottom: 40 }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Mezzopedia Admin</strong>
          <div className="flex wrap"><button className="btn btn-light" onClick={loadAll}>Refresh</button><button className="btn btn-danger" onClick={logout}>Logout</button></div>
        </nav>

        {message && <div className="alert alert-info">{message}</div>}

        <section className="grid grid-4">
          <Metric title="Participants" value={String(participants.length)} />
          <Metric title="Questions" value={String(questions.length)} />
          <Metric title="Completed" value={String(completedCount)} />
          <Metric title="AI Events" value={String(proctoringEvents.length)} />
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          <div className="tabs no-print">
            {tabs.map(t => <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t === 'proctoring' ? 'AI Proctoring' : t === 'loginLogs' ? 'Login Logs' : title(t)}</button>)}
          </div>

          {tab === 'dashboard' && <Dashboard results={results} questions={questions} />}

          {tab === 'participants' && <div className="grid">
            <form className="grid grid-2" onSubmit={addParticipant} autoComplete="off">
              <SelectField label="Category" value={participantForm.category} onChange={v => setParticipantForm({ ...participantForm, category: v })} />
              <DropdownField label="Payment Status" value={participantForm.paymentStatus} options={PAYMENT_STATUSES as unknown as string[]} onChange={v => setParticipantForm({ ...participantForm, paymentStatus: v })} />
              <DropdownField label="Stage" value={participantForm.contestStage} options={CONTEST_STAGES as unknown as string[]} onChange={v => setParticipantForm({ ...participantForm, contestStage: v })} />
              <Field label="Name" value={participantForm.name} onChange={v => setParticipantForm({ ...participantForm, name: v })} />
              <Field label="Usercode" value={participantForm.usercode} onChange={v => setParticipantForm({ ...participantForm, usercode: v })} />
              <Field label="Password" value={participantForm.password} onChange={v => setParticipantForm({ ...participantForm, password: v })} />
              <button className="btn btn-primary" style={{ alignSelf: 'end' }}>Add Participant</button>
            </form>
            <div className="card card-pad" style={{ boxShadow: 'none' }}>
              <h3>Bulk Import</h3>
              <p className="small muted">Paste CSV lines in this order: category,name,usercode,password,payment_status,stage</p>
              <textarea className="textarea" value={csvText} onChange={e => setCsvText(e.target.value)} placeholder="Primary 5,Ama Mensah,MZP001,secret123,paid,Stage 1" />
              <div className="flex wrap" style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={importParticipants}>Import CSV</button><button className="btn btn-light" onClick={exportParticipantsExcel}>Export Participants</button></div>
            </div>
            <ParticipantsTable participants={participants} onDelete={deleteParticipant} />
          </div>}

          {tab === 'questions' && <div className="grid">
            <form className="grid" onSubmit={saveQuestion}>
              {editingQuestionId && <div className="alert alert-info"><strong>Editing question.</strong> Save to update it or cancel editing below.</div>}
              <div className="grid grid-3">
                <SelectField label="Category" value={questionForm.category} onChange={v => setQuestionForm({ ...questionForm, category: v })} />
                <DropdownField label="Stage/Phase" value={questionForm.phase} options={CONTEST_STAGES as unknown as string[]} onChange={v => setQuestionForm({ ...questionForm, phase: v })} />
                <DropdownField label="Status" value={questionForm.isActive ? 'Active' : 'Inactive'} options={['Active','Inactive']} onChange={v => setQuestionForm({ ...questionForm, isActive: v === 'Active' })} />
              </div>
              <MathField label="Question Text" value={questionForm.questionText} multiline onChange={v => setQuestionForm({ ...questionForm, questionText: v })} />
              <label><span className="label">Question Image</span><input key={`q-${fileInputKey}`} type="file" accept="image/*" onChange={e => uploadImage(e.target.files?.[0] || null, 'questions', 'questionImageUrl')} /></label>
              {questionForm.questionImageUrl && <div className="small muted">Question image linked. It will be saved when you save the question.</div>}
              <div className="grid grid-2">
                <MathField label="Option A" value={questionForm.optionA} onChange={v => setQuestionForm({ ...questionForm, optionA: v })} />
                <MathField label="Option B" value={questionForm.optionB} onChange={v => setQuestionForm({ ...questionForm, optionB: v })} />
                <MathField label="Option C" value={questionForm.optionC} onChange={v => setQuestionForm({ ...questionForm, optionC: v })} />
                <MathField label="Option D" value={questionForm.optionD} onChange={v => setQuestionForm({ ...questionForm, optionD: v })} />
              </div>
              <details><summary><strong>Optional answer images</strong></summary><div className="grid grid-2" style={{ marginTop: 12 }}><label><span className="label">Option A Image</span><input key={`a-${fileInputKey}`} type="file" accept="image/*" onChange={e => uploadImage(e.target.files?.[0] || null, 'option-a', 'optionAImage')} /></label><label><span className="label">Option B Image</span><input key={`b-${fileInputKey}`} type="file" accept="image/*" onChange={e => uploadImage(e.target.files?.[0] || null, 'option-b', 'optionBImage')} /></label><label><span className="label">Option C Image</span><input key={`c-${fileInputKey}`} type="file" accept="image/*" onChange={e => uploadImage(e.target.files?.[0] || null, 'option-c', 'optionCImage')} /></label><label><span className="label">Option D Image</span><input key={`d-${fileInputKey}`} type="file" accept="image/*" onChange={e => uploadImage(e.target.files?.[0] || null, 'option-d', 'optionDImage')} /></label></div></details>
              <div className="grid grid-2"><label><span className="label">Correct Option</span><select className="select" value={questionForm.correctOptionId} onChange={e => setQuestionForm({ ...questionForm, correctOptionId: e.target.value })}>{['A','B','C','D'].map(o => <option key={o}>{o}</option>)}</select></label><Field label="Points" value={questionForm.points} onChange={v => setQuestionForm({ ...questionForm, points: Number(v || 1) })} /></div>
              <div className="flex wrap"><button className="btn btn-primary">{editingQuestionId ? 'Update Question' : 'Save Question'}</button>{editingQuestionId && <button type="button" className="btn btn-light" onClick={cancelEditQuestion}>Cancel Edit</button>}</div>
            </form>
            <QuestionsTable questions={questions} onDelete={deleteQuestion} onEdit={editQuestion} />
          </div>}

          {tab === 'results' && <div className="grid"><div className="flex wrap"><button className="btn btn-primary" onClick={exportResultsExcel}>Export Excel</button><button className="btn btn-light" onClick={loadResults}>Refresh Results</button><DropdownField label="Class/Category" value={resultCategory} options={['All', ...DEFAULT_CATEGORIES]} onChange={setResultCategory} compact /><DropdownField label="Order By" value={resultSort} options={['highestScore','fastestTime','category']} onChange={setResultSort} compact /></div><ResultsTable results={sortedResults} /></div>}
          {tab === 'certificates' && <div className="grid"><p>Generate certificate PDFs for completed candidates. A more advanced designed template can be added later.</p><ResultsTable results={sortedResults} certificateAction={generateCertificate} /></div>}
          {tab === 'proctoring' && <ProctoringReview events={filteredProctoringEvents} counts={proctorCounts} search={proctorSearch} severity={proctorSeverity} onSearch={setProctorSearch} onSeverity={setProctorSeverity} onRefresh={loadProctoringEvents} />}
          {tab === 'loginLogs' && <LoginLogs events={loginEvents} onRefresh={loadLoginEvents} />}
          {tab === 'security' && <SecurityPanel />}
        </section>
      </div>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) { return <div className="card card-pad" style={{ boxShadow: 'none', textAlign: 'center' }}><div className="muted small">{title}</div><h2>{value}</h2></div>; }
function Field({ label, value, onChange }: { label: string; value: string | number; onChange: (v: string) => void }) { return <label><span className="label">{label}</span><input className="input" value={value} onChange={e => onChange(e.target.value)} autoComplete="off" /></label>; }
function SelectField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) { return <DropdownField label={label} value={value} options={DEFAULT_CATEGORIES} onChange={onChange} />; }
function DropdownField({ label, value, options, onChange, compact }: { label: string; value: string; options: string[]; onChange: (v: string) => void; compact?: boolean }) { return <label style={compact ? { minWidth: 180 } : undefined}><span className="label">{label}</span><select className="select" value={value} onChange={e => onChange(e.target.value)}>{options.map(opt => <option key={opt} value={opt}>{opt}</option>)}</select></label>; }
function title(v: string) { return v.charAt(0).toUpperCase() + v.slice(1); }
function formatTime(seconds: number) { const m = Math.floor(seconds / 60); const s = seconds % 60; return `${m}m ${s}s`; }
function appendSymbol(value: string, symbol: string) { return `${value}${symbol}`; }

function MathField({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return <label><span className="label">{label}</span><div className="flex wrap" style={{ gap: 6, marginBottom: 8 }}>{SYMBOLS.map(sym => <button type="button" key={`${label}-${sym.label}`} className="tab" onClick={() => onChange(appendSymbol(value, sym.value))}>{sym.label}</button>)}</div>{multiline ? <textarea className="textarea" value={value} onChange={e => onChange(e.target.value)} /> : <input className="input" value={value} onChange={e => onChange(e.target.value)} autoComplete="off" />}</label>;
}

function Dashboard({ results, questions }: { results: Result[]; questions: Question[] }) {
  const byCategory = DEFAULT_CATEGORIES.map(cat => ({ category: cat, questions: questions.filter(q => q.category === cat).length, results: results.filter(r => r.category === cat).length }));
  return <div className="table-wrap"><table><thead><tr><th>Category</th><th>Questions Uploaded</th><th>Completed Results</th></tr></thead><tbody>{byCategory.map(row => <tr key={row.category}><td>{row.category}</td><td>{row.questions}</td><td>{row.results}</td></tr>)}</tbody></table></div>;
}

function ParticipantsTable({ participants, onDelete }: { participants: Participant[]; onDelete: (id: string) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Name</th><th>Code</th><th>Category</th><th>Payment</th><th>Stage</th><th>Access</th><th>Logins</th><th>Action</th></tr></thead><tbody>{participants.map(p => <tr key={p.id}><td>{p.name}</td><td>{p.usercode}</td><td>{p.category}</td><td>{p.payment_status}</td><td>{p.contest_stage || 'Stage 1'}</td><td>{p.is_active ? 'Open' : 'Closed'}</td><td>{p.login_count}</td><td><button className="btn btn-danger" onClick={() => onDelete(p.id)}>Delete</button></td></tr>)}</tbody></table></div>;
}

function QuestionsTable({ questions, onDelete, onEdit }: { questions: Question[]; onDelete: (id: string) => void; onEdit: (question: Question) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Category</th><th>Question</th><th>Correct</th><th>Phase</th><th>Active</th><th>Action</th></tr></thead><tbody>{questions.map(q => <tr key={q.id}><td>{q.category}</td><td style={{ whiteSpace: 'pre-wrap' }}>{q.question_text.slice(0, 160)}</td><td>{q.correct_option_id}</td><td>{q.phase}</td><td>{q.is_active ? 'Yes' : 'No'}</td><td><div className="flex wrap"><button className="btn btn-light" onClick={() => onEdit(q)}>Edit</button><button className="btn btn-danger" onClick={() => onDelete(q.id)}>Delete</button></div></td></tr>)}</tbody></table></div>;
}

function ResultsTable({ results, certificateAction }: { results: Result[]; certificateAction?: (result: Result) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Name</th><th>Code</th><th>Category</th><th>Score</th><th>%</th><th>Time</th><th>Risk</th>{certificateAction && <th>Certificate</th>}</tr></thead><tbody>{results.map(r => <tr key={r.id}><td>{r.name}</td><td>{r.usercode}</td><td>{r.category}</td><td>{r.score}/{r.maxScore}</td><td>{r.percentage}%</td><td>{formatTime(r.timeUsedSeconds)}</td><td>{r.proctoringSummary?.riskLevel || 'LOW'} ({r.proctoringSummary?.total || 0})</td>{certificateAction && <td><button className="btn btn-light" onClick={() => certificateAction(r)}>Download</button></td>}</tr>)}</tbody></table></div>;
}

function ProctoringReview({ events, counts, search, severity, onSearch, onSeverity, onRefresh }: { events: ProctorEvent[]; counts: { total: number; critical: number; high: number; audio: number; images: number }; search: string; severity: string; onSearch: (v: string) => void; onSeverity: (v: string) => void; onRefresh: () => void }) {
  return <div className="grid">
    <div className="grid grid-4">
      <Metric title="Total Events" value={String(counts.total)} />
      <Metric title="Critical" value={String(counts.critical)} />
      <Metric title="High" value={String(counts.high)} />
      <Metric title="Audio Clips" value={String(counts.audio)} />
    </div>
    <div className="grid grid-2">
      <div className="alert alert-info"><strong>Face evidence</strong><br />Use this to confirm the candidate was visible and the camera was not covered.</div>
      <div className="alert alert-info"><strong>Screen evidence</strong><br />Use this to check whether the candidate stayed on the test page. It works only when screen sharing is allowed.</div>
      <div className="alert alert-info"><strong>Audio evidence</strong><br />Short audio clips are saved only when suspicious sound or voice is detected. Click Play/Open Audio to listen later.</div>
      <div className="alert alert-info"><strong>Severity guide</strong><br />Critical/High needs review before accepting the result. Medium is suspicious. Low is usually routine monitoring.</div>
    </div>
    <div className="flex wrap no-print"><button className="btn btn-light" onClick={onRefresh}>Refresh AI Proctoring</button><a className="btn btn-primary" href="/admin/proctoring">Open Full Review Page</a><label style={{ minWidth: 220 }}><span className="label">Search candidate/code/event</span><input className="input" value={search} onChange={e => onSearch(e.target.value)} /></label><DropdownField label="Severity" value={severity} options={['All','critical','high','medium','low']} onChange={onSeverity} compact /></div>
    <ProctoringTable events={events} />
  </div>;
}

function EvidenceViewer({ evidence }: { evidence: Evidence }) {
  const hasEvidence = evidence?.faceSnapshotUrl || evidence?.screenSnapshotUrl || evidence?.audioEvidenceUrl;
  if (!hasEvidence) return <span className="small muted">No file saved</span>;
  return <div className="grid" style={{ gap: 8 }}>
    <div className="flex wrap">
      {evidence.faceSnapshotUrl && <a className="btn btn-light" href={evidence.faceSnapshotUrl} target="_blank">View Face</a>}
      {evidence.screenSnapshotUrl && <a className="btn btn-light" href={evidence.screenSnapshotUrl} target="_blank">View Screen</a>}
      {evidence.audioEvidenceUrl && <a className="btn btn-light" href={evidence.audioEvidenceUrl} target="_blank">Open Audio</a>}
    </div>
    {evidence.audioEvidenceUrl && <audio controls preload="none" src={evidence.audioEvidenceUrl} style={{ width: 260 }} />}
  </div>;
}

function ProctoringTable({ events }: { events: ProctorEvent[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Time</th><th>Candidate</th><th>Code</th><th>Category</th><th>Stage</th><th>Violation</th><th>Meaning</th><th>Severity</th><th>Evidence</th><th>Details</th></tr></thead><tbody>{events.map(e => <tr key={e.id}><td>{new Date(e.createdAt).toLocaleString()}</td><td>{e.name}</td><td>{e.usercode}</td><td>{e.category}</td><td>{e.contestStage || ''}</td><td><strong>{e.eventType.replaceAll('_', ' ')}</strong></td><td>{explain(e.eventType)}</td><td><strong>{e.severity.toUpperCase()}</strong><br /><span className="small muted">{severityMeaning(e.severity)}</span></td><td><EvidenceViewer evidence={e.evidence || {}} /></td><td><code className="small">{JSON.stringify(e.details || {}).slice(0, 240)}</code></td></tr>)}</tbody></table></div>;
}

function LoginLogs({ events, onRefresh }: { events: LoginEvent[]; onRefresh: () => void }) {
  return <div className="grid">
    <div className="alert alert-info"><strong>Login Logs</strong><br />This page shows when each user logged in, the device type, browser, operating system, current session status, and repeat/double login events.</div>
    <div className="flex wrap"><button className="btn btn-light" onClick={onRefresh}>Refresh Login Logs</button></div>
    <div className="table-wrap"><table><thead><tr><th>Time</th><th>Candidate</th><th>Code</th><th>Category</th><th>Stage</th><th>Login Type</th><th>Device</th><th>Browser</th><th>OS</th><th>Session</th><th>Details</th></tr></thead><tbody>{events.map(event => <tr key={event.id}><td>{new Date(event.createdAt).toLocaleString()}</td><td>{event.name}</td><td>{event.usercode}</td><td>{event.category}</td><td>{event.contestStage || ''}</td><td><strong>{event.eventType.replaceAll('_', ' ')}</strong></td><td>{event.deviceType || 'Unknown'}</td><td>{event.browserName || 'Unknown'}</td><td>{event.osName || 'Unknown'}</td><td>{event.sessionStatus || ''}</td><td><code className="small">{JSON.stringify(event.details || {}).slice(0, 220)}</code></td></tr>)}</tbody></table></div>
  </div>;
}

function SecurityPanel() {
  return <div className="grid"><div className="alert alert-info"><strong>Current security foundation:</strong> server-side admin APIs, HTTP-only cookies, bcrypt password hashing, Supabase service key kept off the browser, RLS-denied public tables, proctoring logs, evidence uploads, repeat-login detection and no correct answers sent to participants.</div><ul><li>Before national launch: use a separate production Supabase project.</li><li>Set a strong ADMIN_PASSWORD_HASH and JWT_SECRET in Vercel.</li><li>Keep the Supabase service role key only in server environment variables.</li><li>Run a full pilot with real devices: Android, iPhone, tablets and laptops.</li><li>Use the AI Proctoring tab to review violations and evidence before confirming final results.</li></ul><div className="alert alert-info">Some browser restrictions cannot be fully bypassed: web apps cannot secretly see other apps, record the whole device, or capture the screen unless the participant grants screen-sharing permission.</div></div>;
}
