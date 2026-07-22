'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

type QuestionForm = {
  category: string;
  phase: string;
  questionText: string;
  questionImageUrl: string;
  optionA: string;
  optionAImageUrl: string;
  optionB: string;
  optionBImageUrl: string;
  optionC: string;
  optionCImageUrl: string;
  optionD: string;
  optionDImageUrl: string;
  correctOptionId: string;
  explanation: string;
  points: number;
  isActive: boolean;
};

const CATEGORY_OPTIONS = ['All', ...DEFAULT_CATEGORIES];
const STAGE_OPTIONS = ['All', ...CONTEST_STAGES];
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

function emptyForm(category = DEFAULT_CATEGORIES[0], phase = 'Stage 1'): QuestionForm {
  return {
    category,
    phase,
    questionText: '',
    questionImageUrl: '',
    optionA: '',
    optionAImageUrl: '',
    optionB: '',
    optionBImageUrl: '',
    optionC: '',
    optionCImageUrl: '',
    optionD: '',
    optionDImageUrl: '',
    correctOptionId: 'A',
    explanation: '',
    points: 1,
    isActive: true
  };
}

function optionById(question: Question, id: string) {
  return (question.options || []).find(option => option.id === id) || { id, text: '', imageUrl: '' };
}

function questionToForm(question: Question): QuestionForm {
  return {
    category: question.category,
    phase: question.phase || 'Stage 1',
    questionText: question.question_text || '',
    questionImageUrl: question.question_image_url || '',
    optionA: optionById(question, 'A').text || '',
    optionAImageUrl: optionById(question, 'A').imageUrl || '',
    optionB: optionById(question, 'B').text || '',
    optionBImageUrl: optionById(question, 'B').imageUrl || '',
    optionC: optionById(question, 'C').text || '',
    optionCImageUrl: optionById(question, 'C').imageUrl || '',
    optionD: optionById(question, 'D').text || '',
    optionDImageUrl: optionById(question, 'D').imageUrl || '',
    correctOptionId: question.correct_option_id || 'A',
    explanation: question.explanation || '',
    points: Number(question.points || 1),
    isActive: Boolean(question.is_active)
  };
}

function formToPayload(form: QuestionForm) {
  return {
    category: form.category,
    phase: form.phase,
    questionText: form.questionText,
    questionImageUrl: form.questionImageUrl,
    correctOptionId: form.correctOptionId,
    explanation: form.explanation,
    points: Number(form.points || 1),
    isActive: form.isActive,
    options: [
      { id: 'A', text: form.optionA, imageUrl: form.optionAImageUrl },
      { id: 'B', text: form.optionB, imageUrl: form.optionBImageUrl },
      { id: 'C', text: form.optionC, imageUrl: form.optionCImageUrl },
      { id: 'D', text: form.optionD, imageUrl: form.optionDImageUrl }
    ]
  };
}

function validateForm(form: QuestionForm) {
  if (!form.questionText.trim()) return 'Question text is required.';
  const options = [form.optionA, form.optionB, form.optionC, form.optionD].map(value => value.trim()).filter(Boolean);
  if (options.length < 2) return 'At least two answer options are required.';
  const lower = options.map(value => value.toLowerCase());
  if (new Set(lower).size !== lower.length) return 'Do not enter the same answer text in more than one option.';
  return '';
}

function useMathTextInsert(value: string, onChange: (value: string) => void) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const insert = (symbol: string) => {
    const input = ref.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    const next = `${value.slice(0, start)}${symbol}${value.slice(end)}`;
    onChange(next);
    const nextPos = start + symbol.length;
    setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(nextPos, nextPos);
    }, 0);
  };
  return { ref, insert };
}

export default function FilteredQuestionsPage() {
  const [ready, setReady] = useState(false);
  const [category, setCategory] = useState('All');
  const [stage, setStage] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [moveTargetStage, setMoveTargetStage] = useState('Stage 1');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<QuestionForm>(emptyForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const activeCount = useMemo(() => questions.filter(q => q.is_active).length, [questions]);
  const filterLabel = `${category === 'All' ? 'all categories' : category} / ${stage === 'All' ? 'all stages' : stage}${searchText.trim() ? ` / search: "${searchText.trim()}"` : ''}`;

  async function loadQuestions(nextCategory = category, nextStage = stage, nextSearch = searchText) {
    setLoading(true);
    setError('');
    setMessage('');
    const params = new URLSearchParams({ category: nextCategory, phase: nextStage });
    if (nextSearch.trim()) params.set('search', nextSearch.trim());
    const json = await fetch(`/api/admin/questions?${params.toString()}`).then(r => r.json()).catch(() => ({}));
    if (json.error) setError(json.error);
    setQuestions(json.questions || []);
    setLoading(false);
  }

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) throw new Error('Admin login required.');
      setReady(true);
      return loadQuestions('All', 'All', '');
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
    if (editingId === id) cancelEdit();
    loadQuestions();
  }

  async function applyFilter() {
    await loadQuestions(category, stage, searchText);
  }

  function startEdit(question: Question) {
    setEditingId(question.id);
    setEditForm(questionToForm(question));
    setError('');
    setMessage(`Editing question ${question.question_text.slice(0, 80)}${question.question_text.length > 80 ? '...' : ''}`);
    setTimeout(() => document.getElementById('question-edit-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyForm(category === 'All' ? DEFAULT_CATEGORIES[0] : category, stage === 'All' ? 'Stage 1' : stage));
  }

  async function saveEdit() {
    if (!editingId) return;
    setError('');
    setMessage('');
    const formError = validateForm(editForm);
    if (formError) { setError(formError); return; }

    setSaving(true);
    const res = await fetch(`/api/admin/questions/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formToPayload(editForm))
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setError(json.error || 'Could not update question.'); return; }
    setMessage('Question updated successfully.');
    setEditingId(null);
    await loadQuestions(category, stage, searchText);
  }

  async function deleteMatchingQuestions() {
    if (!questions.length) { setError('No questions are showing for this filter.'); return; }
    const dangerText = category === 'All' && stage === 'All' && !searchText.trim()
      ? `This will permanently delete ALL ${questions.length} questions in the system. Type DELETE ALL to continue.`
      : `This will permanently delete ${questions.length} question(s) for ${filterLabel}. Type DELETE to continue.`;
    const typed = prompt(dangerText);
    if ((category === 'All' && stage === 'All' && !searchText.trim() && typed !== 'DELETE ALL') || (!(category === 'All' && stage === 'All' && !searchText.trim()) && typed !== 'DELETE')) return;

    setLoading(true);
    setError('');
    const res = await fetch('/api/admin/questions/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteIds', ids: questions.map(q => q.id) })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(json.error || 'Could not delete matching questions.'); return; }
    setMessage(`Deleted ${json.deletedCount} question(s).`);
    cancelEdit();
    loadQuestions(category, stage, searchText);
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
      body: JSON.stringify({ action: 'moveIds', ids: questions.map(q => q.id), targetPhase: moveTargetStage })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(json.error || 'Could not move matching questions.'); return; }
    setMessage(`Moved ${json.movedCount} question(s) to ${json.targetPhase}.`);
    cancelEdit();
    loadQuestions(category, stage, searchText);
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
    XLSX.writeFile(workbook, `mezzopedia-questions-${fileSafe(category)}-${fileSafe(stage)}-${fileSafe(searchText || 'all')}.xlsx`);
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
    doc.save(`mezzopedia-questions-${fileSafe(category)}-${fileSafe(stage)}-${fileSafe(searchText || 'all')}.pdf`);
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
          <span className="badge">Question search and editing</span>
          <h1 style={{ marginTop: 12 }}>Find and edit questions quickly</h1>
          <p className="muted">Search by a word or phrase in the question, then click Edit on the matching row. The edit form opens on this same page.</p>

          {message && <div className="alert alert-success">{message}</div>}
          {error && ready && <div className="alert alert-error">{error}</div>}

          <div className="grid grid-4 no-print">
            <label>
              <span className="label">Search word or phrase</span>
              <input className="input" value={searchText} onChange={e => setSearchText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyFilter(); }} placeholder="Type part of the question" />
            </label>
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
            <button className="btn btn-primary" style={{ alignSelf: 'end' }} onClick={applyFilter}>Search / Apply Filter</button>
          </div>

          <div className="grid grid-3" style={{ marginTop: 18 }}>
            <Metric title="Filter" value={filterLabel} />
            <Metric title="Questions Showing" value={`${questions.length} (${activeCount} active)`} />
            <Metric title="Editing" value={editingId ? 'Open' : 'None'} />
          </div>
        </section>

        {editingId && <section id="question-edit-panel" className="card card-pad no-print" style={{ marginTop: 18, border: '1px solid rgba(37,99,235,0.28)' }}>
          <div className="flex between wrap">
            <div>
              <span className="badge">Edit selected question</span>
              <h2 style={{ marginTop: 10 }}>Update question details</h2>
              <p className="muted">Click inside any question/option field, place your cursor, then use the symbol buttons to insert symbols exactly there.</p>
            </div>
            <button className="btn btn-light" onClick={cancelEdit}>Close Editor</button>
          </div>

          <div className="grid grid-3" style={{ marginTop: 14 }}>
            <label><span className="label">Category</span><select className="select" value={editForm.category} onChange={e => setEditForm(prev => ({ ...prev, category: e.target.value }))}>{DEFAULT_CATEGORIES.map(item => <option key={item}>{item}</option>)}</select></label>
            <label><span className="label">Stage</span><select className="select" value={editForm.phase} onChange={e => setEditForm(prev => ({ ...prev, phase: e.target.value }))}>{CONTEST_STAGES.map(item => <option key={item}>{item}</option>)}</select></label>
            <label><span className="label">Status</span><select className="select" value={editForm.isActive ? 'Active' : 'Inactive'} onChange={e => setEditForm(prev => ({ ...prev, isActive: e.target.value === 'Active' }))}><option>Active</option><option>Inactive</option></select></label>
          </div>

          <div style={{ marginTop: 14 }}>
            <MathField label="Question Text" value={editForm.questionText} multiline onChange={questionText => setEditForm(prev => ({ ...prev, questionText }))} />
          </div>

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <Field label="Question Image URL" value={editForm.questionImageUrl} onChange={questionImageUrl => setEditForm(prev => ({ ...prev, questionImageUrl }))} />
            <Field label="Points" value={String(editForm.points)} onChange={points => setEditForm(prev => ({ ...prev, points: Number(points || 1) }))} />
          </div>

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <MathField label="Option A" value={editForm.optionA} onChange={optionA => setEditForm(prev => ({ ...prev, optionA }))} />
            <MathField label="Option B" value={editForm.optionB} onChange={optionB => setEditForm(prev => ({ ...prev, optionB }))} />
            <MathField label="Option C" value={editForm.optionC} onChange={optionC => setEditForm(prev => ({ ...prev, optionC }))} />
            <MathField label="Option D" value={editForm.optionD} onChange={optionD => setEditForm(prev => ({ ...prev, optionD }))} />
          </div>

          <details style={{ marginTop: 14 }}>
            <summary><strong>Optional image URLs for options</strong></summary>
            <div className="grid grid-2" style={{ marginTop: 12 }}>
              <Field label="Option A Image URL" value={editForm.optionAImageUrl} onChange={optionAImageUrl => setEditForm(prev => ({ ...prev, optionAImageUrl }))} />
              <Field label="Option B Image URL" value={editForm.optionBImageUrl} onChange={optionBImageUrl => setEditForm(prev => ({ ...prev, optionBImageUrl }))} />
              <Field label="Option C Image URL" value={editForm.optionCImageUrl} onChange={optionCImageUrl => setEditForm(prev => ({ ...prev, optionCImageUrl }))} />
              <Field label="Option D Image URL" value={editForm.optionDImageUrl} onChange={optionDImageUrl => setEditForm(prev => ({ ...prev, optionDImageUrl }))} />
            </div>
          </details>

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <label><span className="label">Correct Option</span><select className="select" value={editForm.correctOptionId} onChange={e => setEditForm(prev => ({ ...prev, correctOptionId: e.target.value }))}>{['A','B','C','D'].map(item => <option key={item}>{item}</option>)}</select></label>
            <MathField label="Explanation / Solution" value={editForm.explanation} multiline onChange={explanation => setEditForm(prev => ({ ...prev, explanation }))} />
          </div>

          <div className="flex wrap" style={{ marginTop: 18 }}>
            <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>{saving ? 'Saving...' : 'Save Question Changes'}</button>
            <button className="btn btn-light" onClick={cancelEdit} disabled={saving}>Cancel</button>
          </div>
        </section>}

        <section className="card card-pad no-print" style={{ marginTop: 18 }}>
          <h2>Bulk actions for current filter</h2>
          <p className="muted">These actions apply to the questions currently matching: <strong>{filterLabel}</strong>. Search first before deleting or moving only searched questions.</p>
          <div className="grid grid-3">
            <button className="btn btn-light" onClick={exportExcel} disabled={!questions.length || loading}>Export Excel</button>
            <button className="btn btn-light" onClick={exportPdf} disabled={!questions.length || loading}>Export PDF</button>
            <button className="btn btn-danger" onClick={deleteMatchingQuestions} disabled={!questions.length || loading}>Delete Matching Questions</button>
          </div>
          <div className="grid grid-3" style={{ marginTop: 14 }}>
            <label><span className="label">Move matching questions to stage</span><select className="select" value={moveTargetStage} onChange={e => setMoveTargetStage(e.target.value)}>{CONTEST_STAGES.map(item => <option key={item}>{item}</option>)}</select></label>
            <button className="btn btn-primary" style={{ alignSelf: 'end' }} onClick={moveMatchingQuestions} disabled={!questions.length || loading}>Move Questions</button>
          </div>
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
                  <tr key={q.id} style={editingId === q.id ? { outline: '2px solid rgba(37,99,235,0.35)' } : undefined}>
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
                    <td><div className="flex wrap no-print"><button className="btn btn-primary" onClick={() => startEdit(q)}>Edit</button><button className="btn btn-danger" onClick={() => deleteQuestion(q.id)}>Delete</button></div></td>
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

function MathField({ label, value, onChange, multiline }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  const { ref, insert } = useMathTextInsert(value, onChange);
  return <label><span className="label">{label}</span><div className="flex wrap" style={{ gap: 6, marginBottom: 8 }}>{SYMBOLS.map(symbol => <button type="button" key={`${label}-${symbol.label}`} className="tab" onMouseDown={event => { event.preventDefault(); insert(symbol.value); }}>{symbol.label}</button>)}</div>{multiline ? <textarea ref={ref as any} className="textarea" value={value} onChange={e => onChange(e.target.value)} /> : <input ref={ref as any} className="input" value={value} onChange={e => onChange(e.target.value)} autoComplete="off" />}</label>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span className="label">{label}</span><input className="input" value={value} onChange={e => onChange(e.target.value)} autoComplete="off" /></label>;
}

function Metric({ title, value }: { title: string; value: string }) {
  return <div className="card card-pad" style={{ boxShadow: 'none', textAlign: 'center' }}><div className="muted small">{title}</div><h2>{value}</h2></div>;
}

function fileSafe(value: string) {
  return String(value || 'all').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'all';
}
