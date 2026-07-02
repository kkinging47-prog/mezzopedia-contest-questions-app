'use client';

import { useEffect, useMemo, useState } from 'react';
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
  points: number;
  is_active: boolean;
  created_at?: string;
};

export default function FilteredQuestionsPage() {
  const [ready, setReady] = useState(false);
  const [category, setCategory] = useState(DEFAULT_CATEGORIES[0]);
  const [stage, setStage] = useState('Stage 1');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const activeCount = useMemo(() => questions.filter(q => q.is_active).length, [questions]);

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
      return loadQuestions(DEFAULT_CATEGORIES[0], 'Stage 1');
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
          <span className="badge">Category and stage filter</span>
          <h1 style={{ marginTop: 12 }}>Questions for one category and one stage</h1>
          <p className="muted">Select a category and stage. Only questions matching both selections will show below.</p>

          {message && <div className="alert alert-success">{message}</div>}
          {error && <div className="alert alert-error">{error}</div>}

          <div className="grid grid-3 no-print">
            <label>
              <span className="label">Category</span>
              <select className="select" value={category} onChange={e => setCategory(e.target.value)}>
                {DEFAULT_CATEGORIES.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Stage</span>
              <select className="select" value={stage} onChange={e => setStage(e.target.value)}>
                {CONTEST_STAGES.map(item => <option key={item}>{item}</option>)}
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

        <section className="card card-pad" style={{ marginTop: 18 }}>
          {loading && <div className="alert alert-info">Loading selected questions...</div>}
          {!loading && !questions.length && <div className="alert alert-info">No questions found for {category} in {stage}.</div>}

          {!!questions.length && <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
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
                    <td>
                      <strong>{q.question_text}</strong>
                      {q.question_image_url && <div><a href={q.question_image_url} target="_blank" rel="noreferrer">View image</a></div>}
                    </td>
                    <td>{q.correct_option_id}</td>
                    <td>
                      <ol style={{ margin: 0, paddingLeft: 18 }}>
                        {(q.options || []).map(option => <li key={option.id}><strong>{option.id}:</strong> {option.text || 'Image option'}</li>)}
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
