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

type Result = {
  participant: { name: string; usercode: string; category: string; paymentStatus: string };
  stage?: string;
  score: number;
  maxScore: number;
  totalQuestions: number;
  percentage: number;
  timeUsedSeconds: number;
  submittedAt: string;
  proctoringSummary: { riskLevel?: string; total?: number; critical?: number; byType?: Record<string, number> };
  script?: ScriptItem[];
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

  function addScriptToPdf(doc: jsPDF, startY: number) {
    if (!result?.script?.length) return startY;
    let y = ensureSpace(doc, startY, 20);
    doc.setFontSize(14);
    doc.text('Candidate Answer Script', 20, y);
    y += 8;
    doc.setFontSize(9);

    for (const item of result.script) {
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

  function downloadPdf() {
    if (!result || !analysis) return;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('Mezzopedia Contest Result', 20, 20);
    doc.setFontSize(12);
    doc.text(`Name: ${result.participant.name}`, 20, 38);
    doc.text(`Category: ${result.participant.category}`, 20, 48);
    doc.text(`Stage: ${result.stage || ''}`, 20, 58);
    doc.text(`Usercode: ${result.participant.usercode}`, 20, 68);
    doc.text(`Score: ${result.score}/${result.maxScore} (${result.percentage}%)`, 20, 78);
    doc.text(`Time used: ${formatTime(result.timeUsedSeconds)}`, 20, 88);
    doc.text(`Submitted: ${new Date(result.submittedAt).toLocaleString()}`, 20, 98);
    doc.text('Result Analysis:', 20, 116);
    doc.text(doc.splitTextToSize(analysis.summary, 170), 20, 126);
    doc.text(doc.splitTextToSize(analysis.advice, 170), 20, 152);
    addScriptToPdf(doc, 176);
    doc.save(`mezzopedia-result-and-script-${result.participant.usercode}.pdf`);
  }

  function downloadScriptPdf() {
    if (!result) return;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('Mezzopedia Candidate Answer Script', 20, 20);
    doc.setFontSize(11);
    doc.text(`Name: ${result.participant.name}`, 20, 36);
    doc.text(`Category: ${result.participant.category}`, 20, 46);
    doc.text(`Stage: ${result.stage || ''}`, 20, 56);
    doc.text(`Score: ${result.score}/${result.maxScore} (${result.percentage}%)`, 20, 66);
    addScriptToPdf(doc, 84);
    doc.save(`mezzopedia-script-${result.participant.usercode}.pdf`);
  }

  async function downloadCertificatePdf() {
    if (!result) return;
    await downloadCertificate({ name: result.participant.name, category: result.participant.category, usercode: result.participant.usercode }, certificateSettings);
  }

  return (
    <main className="math-bg centered">
      <div className="container" style={{ maxWidth: 1000 }}>
        <div className="card card-pad">
          <div className="flex between wrap no-print">
            <Link href="/" className="badge">← Back to Home</Link>
            {result && <div className="flex wrap"><button className="btn btn-light" onClick={() => window.print()}>Print</button><button className="btn btn-primary" onClick={downloadPdf}>Download Result + Script PDF</button><button className="btn btn-light" onClick={downloadScriptPdf}>Download Script PDF</button><button className="btn btn-success" onClick={downloadCertificatePdf}>Download Certificate PDF</button></div>}
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
              <span className="badge">Official Result</span>
              <h1 style={{ fontSize: '2.4rem', marginTop: 12 }}>{result.participant.name}</h1>
              <p className="muted">{result.participant.category} • {result.stage || 'Contest'} • {result.participant.usercode}</p>

              <div className="grid grid-3" style={{ margin: '24px 0' }}>
                <Metric title="Score" value={`${result.score}/${result.maxScore}`} />
                <Metric title="Percentage" value={`${result.percentage}%`} />
                <Metric title="Time Used" value={formatTime(result.timeUsedSeconds)} />
              </div>

              <div className="card card-pad" style={{ background: '#f7f9fd', boxShadow: 'none' }}>
                <h2>AI Results Analysis</h2>
                <p><strong>{analysis?.summary}</strong></p>
                <p>{analysis?.advice}</p>
                <p className="small muted">Proctoring risk: {result.proctoringSummary?.riskLevel || 'LOW'} • Events logged: {result.proctoringSummary?.total || 0}</p>
              </div>

              <div className="card card-pad" style={{ marginTop: 18, boxShadow: 'none' }}>
                <h2>Answer Script</h2>
                <p className="muted">This shows each question, the options, the answer selected by the candidate, the correct answer and the points awarded.</p>
                {!result.script?.length ? <div className="alert alert-info">The answer script is not available for this result.</div> : <div className="grid">
                  {result.script.map(item => <div key={item.questionId} className="card card-pad" style={{ boxShadow: 'none', border: `1px solid ${item.isCorrect ? '#bbf7d0' : '#fecaca'}` }}>
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
                </div>}
              </div>

              <div className="alert alert-info no-print" style={{ marginTop: 18 }}>You can download your official certificate of participation and the full answer script as PDF using the buttons above.</div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return <div className="card card-pad" style={{ textAlign: 'center', boxShadow: 'none' }}><div className="muted small">{title}</div><h2>{value}</h2></div>;
}

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function createAnalysis(result: Result) {
  const p = result.percentage;
  const risk = result.proctoringSummary?.riskLevel || 'LOW';
  let summary = '';
  let advice = '';
  if (p >= 85) {
    summary = 'Excellent performance. The candidate showed strong mastery and high accuracy.';
    advice = 'The candidate should be considered highly competitive for the next stage, subject to the proctoring review and contest rules.';
  } else if (p >= 70) {
    summary = 'Very good performance. The candidate has a strong foundation with a few areas to improve.';
    advice = 'The candidate should review missed topics and improve speed for later rounds.';
  } else if (p >= 50) {
    summary = 'Fair performance. The candidate demonstrated partial understanding but needs more practice.';
    advice = 'The candidate should focus on weak areas, timed practice and accuracy under pressure.';
  } else {
    summary = 'The score shows that the candidate needs stronger preparation before the next contest stage.';
    advice = 'The candidate should revise core concepts, practice daily and attempt more guided problem solving.';
  }
  if (risk === 'CRITICAL' || risk === 'HIGH') advice += ' The proctoring record requires administrative review before final confirmation.';
  return { summary, advice };
}
