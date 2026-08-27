'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { jsPDF } from 'jspdf';
import { DEFAULT_CATEGORIES } from '@/lib/constants';
import { CertificateSettings, DEFAULT_CERTIFICATE_SETTINGS, downloadCertificate, normalizeCertificateSettings } from '@/lib/certificatePdf';

type ScriptOption = { id: string; text: string; imageUrl?: string };
type ScriptItem = {
  number: number;
  questionId: string;
  category: string;
  stage: string;
  questionText: string;
  questionImageUrl?: string;
  options: ScriptOption[];
  selectedOptionId: string;
  selectedAnswer: string;
  correctOptionId: string;
  correctAnswer: string;
  isCorrect: boolean;
  points: number;
  pointsAwarded: number;
  explanation?: string;
};

type Promotion = {
  isPromoted?: boolean;
  fromStage?: string;
  currentStage?: string;
  promotedTo?: string;
};

type StageResult = {
  stage: string;
  status: string;
  score: number;
  maxScore: number;
  totalQuestions: number;
  percentage: number;
  timeUsedSeconds: number;
  submittedAt: string;
  proctoringSummary?: { riskLevel?: string; total?: number; critical?: number; byType?: Record<string, number> };
  script?: ScriptItem[];
};

type OverallSummary = {
  completedStages: number;
  totalScore: number;
  totalMaxScore: number;
  averageScore: number;
  averagePercentage: number;
  totalTimeSeconds: number;
  averageTimeSeconds: number;
  correctQuestions: number;
  wrongQuestions: number;
  unansweredQuestions: number;
  strongStages: string[];
  weakStages: string[];
  wrongByStage: Array<{ stage: string; wrongQuestionNumbers: number[]; correct: number; wrong: number }>;
  trend: string;
  analysis: string;
};

type Result = {
  participant: { name: string; usercode: string; category: string; paymentStatus: string; currentStage?: string; class?: string; school?: string; location?: string; region?: string };
  stage?: string;
  currentStage?: string;
  promotion?: Promotion;
  isLiveFinalist?: boolean;
  certificateDate?: string;
  score: number;
  maxScore: number;
  totalQuestions: number;
  percentage: number;
  timeUsedSeconds: number;
  submittedAt: string;
  proctoringSummary: { riskLevel?: string; total?: number; critical?: number; byType?: Record<string, number> };
  script?: ScriptItem[];
  stageResults?: Array<StageResult | null>;
  overallSummary?: OverallSummary;
};

export default function ResultsPage() {
  const [category, setCategory] = useState(DEFAULT_CATEGORIES[0]);
  const [usercode, setUsercode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [certificateSettings, setCertificateSettings] = useState<Required<CertificateSettings>>(DEFAULT_CERTIFICATE_SETTINGS);

  const analysis = useMemo(() => result ? createAnalysis(result) : null, [result]);
  const promotedTo = result?.promotion?.isPromoted ? result.promotion.promotedTo : '';
  const stageRows = useMemo(() => (result?.stageResults || []).filter(Boolean) as StageResult[], [result]);
  const stagesWithScripts = useMemo(() => stageRows.filter(stage => (stage.script || []).length), [stageRows]);

  useEffect(() => {
    fetch('/api/auth/participant/logout', { method: 'POST' }).catch(() => null);
    fetch('/api/certificate-settings').then(r => r.json()).then(json => setCertificateSettings(normalizeCertificateSettings(json.settings))).catch(() => null);
  }, []);

  async function lookup(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    const res = await fetch('/api/results/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, usercode, password })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(json.error || 'Could not find result.');
      return;
    }
    setResult(json.result);
  }

  function addWrappedText(doc: jsPDF, text: string, x: number, y: number, width = 170, lineHeight = 5) {
    const lines = doc.splitTextToSize(text || '', width);
    doc.text(lines, x, y);
    return y + lines.length * lineHeight;
  }

  function ensureSpace(doc: jsPDF, y: number, needed = 28) {
    if (y + needed > 285) {
      doc.addPage();
      return 18;
    }
    return y;
  }

  function addStageSummaryToPdf(doc: jsPDF, startY: number) {
    if (!result?.overallSummary) return startY;
    let y = ensureSpace(doc, startY, 42);
    const summary = result.overallSummary;
    doc.setFontSize(14);
    doc.text('Three-Stage Summary Report', 20, y);
    y += 8;
    doc.setFontSize(10);
    y = addWrappedText(doc, `Average score: ${summary.averageScore} points per completed stage. Average percentage: ${summary.averagePercentage}%. Average time: ${formatTime(summary.averageTimeSeconds)}.`, 20, y, 170, 5);
    y = addWrappedText(doc, `Questions correct: ${summary.correctQuestions}. Wrong: ${summary.wrongQuestions}. Unanswered: ${summary.unansweredQuestions}. Trend: ${summary.trend}.`, 20, y + 2, 170, 5);
    y = addWrappedText(doc, `AI analysis: ${summary.analysis}`, 20, y + 2, 170, 5);

    for (const stage of stageRows) {
      y = ensureSpace(doc, y + 4, 24);
      doc.setFont('helvetica', 'bold');
      doc.text(`${stage.stage}: ${stage.score}/${stage.maxScore} (${stage.percentage}%)`, 20, y);
      doc.setFont('helvetica', 'normal');
      y += 6;
      const wrong = summary.wrongByStage?.find(item => item.stage === stage.stage);
      const wrongList = wrong?.wrongQuestionNumbers?.length ? wrong.wrongQuestionNumbers.join(', ') : 'None';
      y = addWrappedText(doc, `Time: ${formatTime(stage.timeUsedSeconds)}. Correct: ${wrong?.correct ?? 0}. Wrong/Unanswered: ${wrong?.wrong ?? 0}. Questions to review: ${wrongList}.`, 24, y, 160, 5);
    }
    return y + 4;
  }

  function addStageHeaderToPdf(doc: jsPDF, y: number, stage: StageResult) {
    y = ensureSpace(doc, y, 26);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`${stage.stage} Result`, 20, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    y += 7;
    doc.text(`Score: ${stage.score}/${stage.maxScore} (${stage.percentage}%)`, 20, y);
    doc.text(`Time: ${formatTime(stage.timeUsedSeconds)}`, 92, y);
    y += 7;
    doc.text(`Submitted: ${formatDate(stage.submittedAt)}`, 20, y);
    return y + 8;
  }

  function addScriptToPdf(doc: jsPDF, startY: number, script: ScriptItem[] = [], title = 'Candidate Answer Script') {
    if (!script.length) return startY;
    let y = ensureSpace(doc, startY, 20);
    doc.setFontSize(14);
    doc.text(title, 20, y);
    y += 8;
    doc.setFontSize(9);

    for (const item of script) {
      y = ensureSpace(doc, y, 45);
      doc.setFont('helvetica', 'bold');
      y = addWrappedText(doc, `${item.number}. ${item.questionText}`, 20, y, 170, 4.5);
      doc.setFont('helvetica', 'normal');
      if (item.questionImageUrl) y = addWrappedText(doc, `Question image: ${item.questionImageUrl}`, 20, y + 1, 170, 4.5);
      for (const option of item.options || []) {
        y = addWrappedText(doc, `${option.id}. ${option.text || 'Image option'}${option.imageUrl ? ` (${option.imageUrl})` : ''}`, 24, y + 1, 160, 4.5);
      }
      const status = item.isCorrect ? 'Correct' : 'Wrong';
      y = addWrappedText(doc, `Selected: ${item.selectedOptionId || 'Not answered'} ${item.selectedAnswer ? `- ${item.selectedAnswer}` : ''}`, 20, y + 2, 170, 4.5);
      y = addWrappedText(doc, `Correct: ${item.correctOptionId} ${item.correctAnswer ? `- ${item.correctAnswer}` : ''}`, 20, y + 1, 170, 4.5);
      y = addWrappedText(doc, `Points: ${item.pointsAwarded}/${item.points} • ${status}`, 20, y + 1, 170, 4.5);
      if (item.explanation) y = addWrappedText(doc, `Explanation: ${item.explanation}`, 20, y + 1, 170, 4.5);
      y += 4;
    }
    return y;
  }

  function addAllStageScriptsToPdf(doc: jsPDF, startY: number) {
    let y = startY;
    for (const stage of stagesWithScripts) {
      y = ensureSpace(doc, y + 6, 35);
      y = addStageHeaderToPdf(doc, y, stage);
      y = addScriptToPdf(doc, y, stage.script || [], `${stage.stage} Answer Script`);
    }
    return y;
  }

  function addHeader(doc: jsPDF, title: string) {
    if (!result) return 20;
    doc.setFontSize(18);
    doc.text(title, 20, 20);
    doc.setFontSize(11);
    doc.text(`Name: ${result.participant.name}`, 20, 36);
    doc.text(`Category/Class: ${result.participant.class || result.participant.category}`, 20, 46);
    doc.text(`Usercode: ${result.participant.usercode}`, 20, 56);
    if (promotedTo) doc.text(`Promotion: Promoted to ${promotedTo}`, 20, 66);
    if (result.participant.school) doc.text(`School: ${result.participant.school}`, 20, promotedTo ? 76 : 66);
    return promotedTo ? (result.participant.school ? 88 : 78) : (result.participant.school ? 78 : 68);
  }

  function downloadPdf() {
    if (!result || !analysis) return;
    const doc = new jsPDF();
    let y = addHeader(doc, 'Mezzopedia Contest Result and Summary');
    doc.setFontSize(11);
    doc.text(`Latest stage: ${result.stage || ''}`, 20, y); y += 10;
    doc.text(`Latest score: ${result.score}/${result.maxScore} (${result.percentage}%)`, 20, y); y += 10;
    doc.text(`Latest time used: ${formatTime(result.timeUsedSeconds)}`, 20, y); y += 10;
    doc.text(`Submitted: ${formatDate(result.submittedAt)}`, 20, y); y += 14;
    doc.text('Latest Result Analysis:', 20, y); y += 8;
    y = addWrappedText(doc, analysis.summary, 20, y, 170, 5);
    y = addWrappedText(doc, analysis.advice, 20, y + 2, 170, 5);
    y = addStageSummaryToPdf(doc, y + 8);
    addAllStageScriptsToPdf(doc, y + 4);
    doc.save(`mezzopedia-result-summary-all-stages-${result.participant.usercode}.pdf`);
  }

  function downloadSummaryPdf() {
    if (!result) return;
    const doc = new jsPDF();
    const y = addHeader(doc, 'Mezzopedia Three-Stage Summary Report');
    addStageSummaryToPdf(doc, y);
    doc.save(`mezzopedia-three-stage-summary-${result.participant.usercode}.pdf`);
  }

  function downloadAllScriptsPdf() {
    if (!result) return;
    const doc = new jsPDF();
    const y = addHeader(doc, 'Mezzopedia All Stage Answer Scripts');
    addAllStageScriptsToPdf(doc, y);
    doc.save(`mezzopedia-all-stage-scripts-${result.participant.usercode}.pdf`);
  }

  function downloadStageScriptPdf(stage: StageResult) {
    if (!result) return;
    const doc = new jsPDF();
    let y = addHeader(doc, `Mezzopedia ${stage.stage} Answer Script`);
    y = addStageHeaderToPdf(doc, y, stage);
    addScriptToPdf(doc, y, stage.script || [], `${stage.stage} Answer Script`);
    doc.save(`mezzopedia-${stage.stage.toLowerCase().replaceAll(' ', '-')}-script-${result.participant.usercode}.pdf`);
  }

  async function downloadCertificatePdf() {
    if (!result) return;
    await downloadCertificate({ name: result.participant.name, category: result.participant.category, usercode: result.participant.usercode, certificateDate: result.certificateDate }, certificateSettings);
  }

  return (
    <main className="math-bg centered">
      <div className="container" style={{ maxWidth: 1080 }}>
        <div className="card card-pad">
          <div className="flex between wrap no-print">
            <Link href="/" className="badge">← Back to Home</Link>
            {result && <div className="flex wrap"><button className="btn btn-light" onClick={() => window.print()}>Print</button><button className="btn btn-primary" onClick={downloadPdf}>Download Result + All Scripts PDF</button><button className="btn btn-light" onClick={downloadSummaryPdf}>Download 3-Stage Summary PDF</button><button className="btn btn-light" onClick={downloadAllScriptsPdf} disabled={!stagesWithScripts.length}>Download All Stage Scripts PDF</button><button className="btn btn-success" onClick={downloadCertificatePdf}>Download Certificate PDF</button></div>}
          </div>

          {!result ? (
            <form onSubmit={lookup} autoComplete="off" style={{ maxWidth: 560, margin: '16px auto 0' }}>
              <h1 style={{ fontSize: '2.2rem' }}>View Your Result</h1>
              <p className="muted">Use the same category, usercode and password you used for the test.</p>
              {error && <div className="alert alert-error">{error}</div>}
              <div className="grid">
                <label><span className="label">Category</span><select className="select" value={category} onChange={e => setCategory(e.target.value)}>{DEFAULT_CATEGORIES.map(cat => <option key={cat}>{cat}</option>)}</select></label>
                <label><span className="label">Usercode</span><input className="input" value={usercode} onChange={e => setUsercode(e.target.value)} autoComplete="off" required /></label>
                <label><span className="label">Password</span><div className="flex"><input className="input" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required /><button type="button" className="btn btn-light" onClick={() => setShowPassword(v => !v)}>{showPassword ? 'Hide' : 'View'}</button></div></label>
              </div>
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 18 }} disabled={loading}>{loading ? 'Checking...' : 'View Result'}</button>
            </form>
          ) : (
            <section style={{ marginTop: 18 }}>
              {promotedTo && <div className="alert alert-success" style={{ textAlign: 'center', padding: '26px 18px', border: '3px solid rgba(15,138,75,0.45)', marginBottom: 18 }}>
                <div style={{ fontSize: 'clamp(2.1rem, 6vw, 4rem)', lineHeight: 1.05, fontWeight: 900, letterSpacing: 1 }}>PROMOTED TO {promotedTo.toUpperCase()}</div>
                <div style={{ fontSize: '1.1rem', marginTop: 8 }}>of the Mezzopedia National Mathematics Competition</div>
              </div>}

              <span className="badge">Official Result</span>
              <h1 style={{ fontSize: '2.4rem', marginTop: 12 }}>{result.participant.name}</h1>
              <p className="muted">{result.participant.class || result.participant.category} • Latest result: {result.stage || 'Contest'} • {result.participant.usercode}</p>

              <div className="grid grid-3" style={{ margin: '24px 0' }}>
                <Metric title="Latest Score" value={`${result.score}/${result.maxScore}`} />
                <Metric title="Latest Percentage" value={`${result.percentage}%`} />
                <Metric title="Latest Time Used" value={formatTime(result.timeUsedSeconds)} />
              </div>

              <div className="card card-pad" style={{ background: '#f7f9fd', boxShadow: 'none' }}>
                <h2>AI Results Analysis</h2>
                <p><strong>{analysis?.summary}</strong></p>
                <p>{analysis?.advice}</p>
                <p className="small muted">Proctoring risk: {result.proctoringSummary?.riskLevel || 'LOW'} • Events logged: {result.proctoringSummary?.total || 0}</p>
              </div>

              <ThreeStageSummary result={result} stageRows={stageRows} />

              <div className="card card-pad" style={{ marginTop: 18, boxShadow: 'none' }}>
                <h2>All Stage Answer Scripts</h2>
                <p className="muted">This shows the questions answered in every completed online stage, including the candidate's selected answer, the correct answer and the points awarded.</p>
                {!stagesWithScripts.length ? <div className="alert alert-info">No stage answer script is available for this result.</div> : <StageScriptsList stages={stagesWithScripts} onDownload={downloadStageScriptPdf} />}
              </div>

              <div className="alert alert-info no-print" style={{ marginTop: 18 }}>You can download the full result, all stage answer scripts, three-stage summary and certificate using the buttons above. Each stage also has its own script download button.</div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function ThreeStageSummary({ result, stageRows }: { result: Result; stageRows: StageResult[] }) {
  const summary = result.overallSummary;
  if (!summary) return null;
  return <div className="card card-pad" style={{ marginTop: 18, boxShadow: 'none' }}>
    <h2>Three-Stage Summary Report</h2>
    <p className="muted">This combines Stage 1, Stage 2 and Stage 3 performance into one report.</p>
    <div className="grid grid-4" style={{ margin: '18px 0' }}>
      <Metric title="Average Score" value={`${summary.averageScore}`} />
      <Metric title="Average %" value={`${summary.averagePercentage}%`} />
      <Metric title="Average Time" value={formatTime(summary.averageTimeSeconds)} />
      <Metric title="Correct / Wrong" value={`${summary.correctQuestions}/${summary.wrongQuestions}`} />
    </div>
    <div className="alert alert-info"><strong>AI summary:</strong> {summary.analysis}</div>
    {!!stageRows.length && <div className="table-wrap"><table>
      <thead><tr><th>Stage</th><th>Score</th><th>%</th><th>Time</th><th>Correct</th><th>Wrong/Unanswered</th><th>Questions to Review</th></tr></thead>
      <tbody>{stageRows.map(stage => {
        const wrong = summary.wrongByStage?.find(item => item.stage === stage.stage);
        return <tr key={stage.stage}>
          <td><strong>{stage.stage}</strong></td>
          <td>{stage.score}/{stage.maxScore}</td>
          <td>{stage.percentage}%</td>
          <td>{formatTime(stage.timeUsedSeconds)}</td>
          <td>{wrong?.correct ?? stage.script?.filter(item => item.isCorrect).length ?? 0}</td>
          <td>{wrong?.wrong ?? stage.script?.filter(item => !item.isCorrect).length ?? 0}</td>
          <td>{wrong?.wrongQuestionNumbers?.length ? wrong.wrongQuestionNumbers.join(', ') : 'None'}</td>
        </tr>;
      })}</tbody>
    </table></div>}
  </div>;
}

function StageScriptsList({ stages, onDownload }: { stages: StageResult[]; onDownload: (stage: StageResult) => void }) {
  return <div className="grid">
    {stages.map(stage => <div key={stage.stage} className="card card-pad" style={{ boxShadow: 'none', border: '1px solid rgba(37,99,235,0.18)' }}>
      <div className="flex between wrap">
        <div>
          <h3 style={{ margin: 0 }}>{stage.stage} Answer Script</h3>
          <p className="small muted" style={{ marginTop: 6 }}>{stage.score}/{stage.maxScore} • {stage.percentage}% • {formatTime(stage.timeUsedSeconds)} • Submitted: {formatDate(stage.submittedAt)}</p>
        </div>
        <button className="btn btn-light no-print" onClick={() => onDownload(stage)}>Download {stage.stage} Script</button>
      </div>
      <ScriptList script={stage.script || []} />
    </div>)}
  </div>;
}

function ScriptList({ script }: { script: ScriptItem[] }) {
  return <div className="grid">
    {script.map(item => <div key={item.questionId} className="card card-pad" style={{ boxShadow: 'none', border: `1px solid ${item.isCorrect ? '#bbf7d0' : '#fecaca'}` }}>
      <div className="flex between wrap">
        <strong>Question {item.number}</strong>
        <span className={item.isCorrect ? 'badge badge-good' : 'badge badge-warn'}>{item.pointsAwarded}/{item.points} point(s) • {item.isCorrect ? 'Correct' : 'Wrong'}</span>
      </div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{item.questionText}</p>
      {item.questionImageUrl && <img src={item.questionImageUrl} alt={`Question ${item.number}`} className="question-image" />}
      <ol style={{ paddingLeft: 20 }}>
        {(item.options || []).map(option => <li key={option.id} style={{ marginBottom: 6 }}>
          <strong>{option.id}.</strong> {option.text || 'Image option'}
          {option.imageUrl && <div><img src={option.imageUrl} alt={`Option ${option.id}`} className="question-image" style={{ maxHeight: 120 }} /></div>}
        </li>)}
      </ol>
      <div className="grid grid-2">
        <div className="alert alert-info"><strong>Selected answer:</strong><br />{item.selectedOptionId || 'Not answered'} {item.selectedAnswer ? `- ${item.selectedAnswer}` : ''}</div>
        <div className="alert alert-success"><strong>Correct answer:</strong><br />{item.correctOptionId} {item.correctAnswer ? `- ${item.correctAnswer}` : ''}</div>
      </div>
      {item.explanation && <p className="small muted"><strong>Explanation:</strong> {item.explanation}</p>}
    </div>)}
  </div>;
}

function Metric({ title, value }: { title: string }) {
  return <div className="card card-pad" style={{ textAlign: 'center', boxShadow: 'none' }}><div className="muted small">{title}</div><h2>{value}</h2></div>;
}

function formatTime(seconds: number) {
  const h = Math.floor((seconds || 0) / 3600);
  const m = Math.floor(((seconds || 0) % 3600) / 60);
  const s = Math.floor((seconds || 0) % 60);
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function createAnalysis(result: Result) {
  const p = result.percentage;
  const risk = result.proctoringSummary?.riskLevel || 'LOW';
  let summary = '';
  let advice = '';
  if (p >= 85) {
    summary = 'Excellent latest-stage performance. The candidate showed strong mastery and high accuracy.';
    advice = 'The candidate should be considered highly competitive, subject to the proctoring review and contest rules.';
  } else if (p >= 70) {
    summary = 'Very good latest-stage performance. The candidate has a strong foundation with a few areas to improve.';
    advice = 'The candidate should review missed questions and improve speed for later rounds.';
  } else if (p >= 50) {
    summary = 'Fair latest-stage performance. The candidate demonstrated partial understanding but needs more practice.';
    advice = 'The candidate should focus on weak areas, timed practice and accuracy under pressure.';
  } else {
    summary = 'The latest score shows that the candidate needs stronger preparation before the next contest stage.';
    advice = 'The candidate should revise core concepts, practice daily and attempt more guided problem solving.';
  }
  if (result.overallSummary?.analysis) advice += ` Overall: ${result.overallSummary.analysis}`;
  if (risk === 'CRITICAL' || risk === 'HIGH') advice += ' The proctoring record requires administrative review before final confirmation.';
  return { summary, advice };
}
