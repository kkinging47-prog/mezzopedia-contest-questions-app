'use client';

import { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import { CONTEST_STAGES, DEFAULT_CATEGORIES } from '@/lib/constants';

type QuestionOption = { id: string; text: string; imageUrl?: string };
type Question = {
  id: string;
  category: string;
  phase: string;
  question_text: string;
  question_image_url?: string;
  options: QuestionOption[];
  correct_option_id: string;
  explanation?: string;
  points: number;
  is_active: boolean;
  created_at?: string;
};

const CATEGORY_OPTIONS = ['All', ...DEFAULT_CATEGORIES];
const STAGE_OPTIONS = ['All', ...CONTEST_STAGES];

export default function FilteredQuestionsPage() {
  const [ready, setReady] = useState(false);
  const [category, setCategory] = useState('All');
  const [stage, setStage] = useState('All');
  const [moveTargetStage, setMoveTargetStage] = useState('Stage 1');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const activeCount = useMemo(() => questions.filter(q => q.is_active).length, [questions]);
  const filterLabel = `${category === 'All' ? 'all categories' : category} / ${stage === 'All' ? 'all stages' : stage}`;

  async function loadQuestions(nextCategory = category, nextStage = stage) {
    setLoading(true);
    setError('');
    setMessage('');
    const params = new URLSearchParams({ category: nextCategory, phase: nextStage });
    const json = await fetch(`/api/admin/questions?${params.toString()}`).then(r => r.json()).catch(() => ({}));
    if (json.error) setError(json.error);
    setQuestions(json.questions || []);
    setLoading(false);
  }

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) throw new Error('Admin login required.');
      setReady(true);
      return loadQuestions('All', 'All');
    }).catch(err => {
      setError(err.message || 'Could not verify admin session.');
      setReady(false);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteQuestion(id: string) {
    if (!confirm('Delete this question permanently?')) return;
    const res = await fetch(`/api/admin/questions/${id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || 'Delete failed.'); return; }
    setMessage('Question deleted.');
    loadQuestions();
  }

  async function applyFilter() {
    await loadQuestions(category, stage);
  }

  async function deleteMatchingQuestions() {
    if (!questions.length) { setError('No questions are showing for this filter.'); return; }
    const dangerText = category === 'All' && stage === 'All'
      ? `This will permanently delete ALL ${questions.length} questions in the system. Type DELETE ALL to continue.`
      : `This will permanently delete ${questions.length} question(s) for ${filterLabel}. Type DELETE to continue.`;
    const typed = prompt(dangerText);
    if ((category === 'All' && stage === 'All' && typed !== 'DELETE ALL') || (!(category === 'All' && stage === 'All') && typed !== 'DELETE')) return;

    setLoading(true);
    setError('');
    const res = await fetch('/api/admin/questions/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteFiltered', category, phase: stage })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(json.error || 'Could not delete matching questions.'); return; }
    setMessage(`Deleted ${json.deletedCount} question(s).`);
    loadQuestions(category, stage);
  }

  async function moveMatchingQuestions() {
    if (!questions.length) { setError('No questions are showing for this filter.'); return; }
    if (!moveTargetStage || moveTargetStage === 'All') { setError('Select the stage to move questions into.'); return; }
    if (!confirm(`Move ${questions.length} question(s) from ${filterLabel} to ${moveTargetStage}?`)) return;

    setLoading(true);
    setError('');
    const res = await fetch('/api/admin/questions/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'moveFiltered', category, phase: stage, targetPhase: moveTargetStage })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(json.error || 'Could not move matching questions.'); return; }
    setMessage(`Moved ${json.movedCount} question(s) to ${json.targetPhase}.`);
    loadQuestions(category, stage);
  }

  async function exportExcel() {
    if (!questions.length) { setError('No questions to export.'); return; }
    const XLSX = await import('xlsx');
    const rows = questions.map((q, index) => {
      const optionMap = Object.fromEntries((q.options || []).map(option => [option.id, option]));
      return {
        No: index + 1,
        Category: q.category,
        Stage: q.phase,
        Question: q.question_text,
        Question_Image_URL: q.question_image_url || '',
        Option_A: optionMap.A?.text || '',
        Option_A_Image_URL: optionMap.A?.imageUrl || '',
        Option_B: optionMap.B?.text || '',
        Option_B_Image_URL: optionMap.B?.imageUrl || '',
        Option_C: optionMap.C?.text || '',
        Option_C_Image_URL: optionMap.C?.imageUrl || '',
        Option_D: optionMap.D?.text || '',
        Option_D_Image_URL: optionMap.D?.imageUrl || '',
        Correct_Option: q.correct_option_id,
        Points: q.points,
        Active: q.is_active ? 'Yes' : 'No',
        Explanation: q.explanation || '',
        Created_At: q.created_at || ''
      };
    });
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Questions');
    XLSX.writeFile(workbook, `mezzopedia-questions-${fileSafe(category)}-${fileSafe(stage)}.xlsx`);
  }

  function exportPdf() {
    if (!questions.length) { setError('No questions to export.'); return; }
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    let y = 18;
    const margin = 14;
    const pageWidth = 182;
    doc.setFontSize(15);
    doc.text('Mezzopedia Questions Export', margin, y);
    y += 8;
    doc.setFontSize(10);
    doc.text(`Filter: ${filterLabel}`, margin, y);
    y += 8;

    questions.forEach((q, index) => {
      const lines = [
        `${index + 1}. [${q.category} • ${q.phase}] ${q.question_text}`,
        ...(q.question_image_url ? [`Question image: ${q.question_image_url}`] : []),
        ...(q.options || []).map(option => `${option.id}. ${option.text || 'Image option'}${option.imageUrl ? ` (${option.imageUrl})` : ''}`),
        `Correct answer: ${q.correct_option_id}    Points: ${q.points}    Status: ${q.is_active ? 'Active' : 'Inactive'}`,
        ...(q.explanation ? [`Explanation: ${q.explanation}`] : [])
      ];
      for (const item of lines) {
        const wrapped = doc.splitTextToSize(item, pageWidth);
        if (y + wrapped.length * 5 > 285) { doc.addPage(); y = 18; }
        doc.text(wrapped, margin, y);
        y += wrapped.length * 5;
      }
      y += 4;
    });
    doc.save(`mezzopedia-questions-${fileSafe(category)}-${fileSafe(stage)}.pdf`);
  }

  if (error && !ready && !loading) {
    return <main className="math-bg centered"><div className="card card-pad"><div className="alert alert-error">{error}</div><a className="btn btn-primary" href="/admin">Back to Admin</a></div></main>;
  }

  return (
    <main className="math-bg" style={{ padding: '24px 0 80px' }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Filtered Questions</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin">Back to Admin</a>
            <a className="btn btn-primary" href="/admin/question-settings">Question Settings</a>
            <button className="btn btn-light" onClick={() => loadQuestions()}>Refresh</button>
          </div>
        </nav>

        <section className="card card-pad">
          <span className="badge">Question management</span>
          <h1 style={{ marginTop: 12 }}>Questions by category and stage</h1>
          <p className="muted">Filter questions, export them, move them to another stage, or delete them in bulk. Use the All options carefully.</p>

          {message && <div className="alert alert-success">{message}</div>}
          {error && <div className="alert alert-error">{error}</div>}

          <div className="grid grid-3 no-print">
            <label>
              <span className="label">Category</span>
              <select className="select" value={category} onChange={e => setCategory(e.target.value)}>
                {CATEGORY_OPTIONS.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Stage</span>
              <select className="select" value={stage} onChange={e => setStage(e.target.value)}>
                {STAGE_OPTIONS.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" style={{ alignSelf: 'end' }} onClick={applyFilter}>Apply Filter</button>
          </div>

          <div className="grid grid-3" style={{ marginTop: 18 }}>
            <Metric title="Selected Category" value={category} />
            <Metric title="Selected Stage" value={stage} />
            <Metric title="Questions Showing" value={`${questions.length} (${activeCount} active)`} />
          </div>
        </section>

        <section className="card card-pad no-print" style={{ marginTop: 18 }}>
          <h2>Bulk actions for current filter</h2>
          <p className="muted">These actions apply to the questions currently matching: <strong>{filterLabel}</strong>.</p>
          <div className="grid grid-3">
            <button className="btn btn-light" onClick={exportExcel} disabled={!questions.length || loading}>Export Excel</button>
            <button className="btn btn-light" onClick={exportPdf} disabled={!questions.length || loading}>Export PDF</button>
            <button className="btn btn-danger" onClick={deleteMatchingQuestions} disabled={!questions.length || loading}>Delete Matching Questions</button>
          </div>
          <div className="grid grid-3" style={{ marginTop: 14 }}>
            <label><span className="label">Move matching questions to stage</span><select className="select" value={moveTargetStage} onChange={e => setMoveTargetStage(e.target.value)}>{CONTEST_STAGES.map(item => <option key={item}>{item}</option>)}</select></label>
            <button className="btn btn-primary" style={{ alignSelf: 'end' }} onClick={moveMatchingQuestions} disabled={!questions.length || loading}>Move Questions</button>
          </div>
          <div className="alert alert-info" style={{ marginTop: 14 }}>For example, choose Category = JHS 1 and Stage = Final Trial, then use Move Questions to move only those questions to Stage 1, Stage 2 or Stage 3.</div>
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          {loading && <div className="alert alert-info">Loading selected questions...</div>}
          {!loading && !questions.length && <div className="alert alert-info">No questions found for {filterLabel}.</div>}

          {!!questions.length && <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Category/Stage</th>
                  <th>Question</th>
                  <th>Correct</th>
                  <th>Options</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {questions.map((q, index) => (
                  <tr key={q.id}>
                    <td>{index + 1}</td>
                    <td><strong>{q.category}</strong><div className="small muted">{q.phase}</div></td>
                    <td>
                      <strong>{q.question_text}</strong>
                      {q.question_image_url && <div><a href={q.question_image_url} target="_blank" rel="noreferrer">View image</a></div>}
                      {q.explanation && <div className="small muted">Explanation: {q.explanation}</div>}
                    </td>
                    <td>{q.correct_option_id}</td>
                    <td>
                      <ol style={{ margin: 0, paddingLeft: 18 }}>
                        {(q.options || []).map(option => <li key={option.id}><strong>{option.id}:</strong> {option.text || 'Image option'} {option.imageUrl && <a href={option.imageUrl} target="_blank" rel="noreferrer">image</a>}</li>)}
                      </ol>
                    </td>
                    <td>{q.is_active ? 'Active' : 'Inactive'}</td>
                    <td><button className="btn btn-danger" onClick={() => deleteQuestion(q.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </section>
      </div>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return <div className="card card-pad" style={{ boxShadow: 'none', textAlign: 'center' }}><div className="muted small">{title}</div><h2>{value}</h2></div>;
}

function fileSafe(value: string) {
  return String(value || 'all').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'all';
}
