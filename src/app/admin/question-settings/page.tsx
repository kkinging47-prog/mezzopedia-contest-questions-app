'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CONTEST_STAGES, DEFAULT_CATEGORIES } from '@/lib/constants';

const COUNT_OPTIONS = [10,20,30,40,50,60,70,80,90,100];
type Settings = Record<string, Record<string, number>>;
type ConfigRow = { key: string; value: unknown };

function defaultSettings(): Settings {
  const value: Settings = {};
  for (const stage of CONTEST_STAGES) {
    value[stage] = {};
    for (const category of DEFAULT_CATEGORIES) value[stage][category] = 10;
  }
  return value;
}

function parseSettings(value: unknown): Settings {
  const base = defaultSettings();
  let raw: any = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  if (!raw || typeof raw !== 'object') return base;
  for (const stage of CONTEST_STAGES) {
    for (const category of DEFAULT_CATEGORIES) {
      const n = Number(raw?.[stage]?.[category]);
      base[stage][category] = COUNT_OPTIONS.includes(n) ? n : 10;
    }
  }
  return base;
}

export default function QuestionSettingsPage() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [seedStage, setSeedStage] = useState('Stage 1');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const totalSelected = useMemo(() => {
    return CONTEST_STAGES.reduce((sum, stage) => sum + DEFAULT_CATEGORIES.reduce((inner, category) => inner + Number(settings[stage]?.[category] || 0), 0), 0);
  }, [settings]);

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) throw new Error('Admin login required.');
      return fetch('/api/admin/config');
    }).then(async res => {
      const json = await res.json();
      const row = (json.config || []).find((item: ConfigRow) => item.key === 'questionCountSettings');
      setSettings(parseSettings(row?.value));
      setReady(true);
    }).catch(err => setError(err.message || 'Could not load question settings.'));
  }, []);

  function updateCount(stage: string, category: string, count: number) {
    setSettings(prev => ({ ...prev, [stage]: { ...(prev[stage] || {}), [category]: count } }));
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setMessage('');
    setError('');
    const res = await fetch('/api/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { questionCountSettings: settings } })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || 'Could not save question settings.'); return false; }
    setMessage('Question count settings saved. New participant logins will use these values immediately.');
    return true;
  }

  async function seedQuestions() {
    setMessage('');
    setError('');
    const res = await fetch('/api/admin/seed-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: seedStage })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || 'Could not seed questions.'); return; }
    setMessage(`Seed complete for ${seedStage}. Inserted ${json.inserted || 0}; skipped ${json.skipped || 0}. Each category now has the seeded 15-question bank where missing.`);
  }

  if (error && !ready) {
    return <main className="math-bg centered"><div className="card card-pad"><div className="alert alert-error">{error}</div><a className="btn btn-primary" href="/admin">Back to Admin</a></div></main>;
  }

  return (
    <main className="math-bg" style={{ padding: '24px 0 80px' }}>
      <div className="container">
        <nav className="nav flex between wrap">
          <strong>Question Bank Settings</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin/performance">Performance</a>
            <a className="btn btn-light" href="/admin/stages">Stages</a>
            <a className="btn btn-primary" href="/admin">Back to Admin</a>
          </div>
        </nav>

        <div className="card card-pad">
          <span className="badge">Per category and stage</span>
          <h1 style={{ marginTop: 12 }}>Questions shown to candidates</h1>
          <p className="muted">Set how many questions should appear for each category in each stage. The system randomly selects this number from the active question bank for that category and stage. If fewer questions are available than the number selected, it will show only the available active questions.</p>
          {message && <div className="alert alert-success">{message}</div>}
          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={save}>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Category</th>
                    {CONTEST_STAGES.map(stage => <th key={stage}>{stage}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {DEFAULT_CATEGORIES.map(category => (
                    <tr key={category}>
                      <td><strong>{category}</strong></td>
                      {CONTEST_STAGES.map(stage => (
                        <td key={`${stage}-${category}`}>
                          <select className="select" value={settings[stage]?.[category] || 10} onChange={e => updateCount(stage, category, Number(e.target.value))}>
                            {COUNT_OPTIONS.map(count => <option key={count} value={count}>{count}</option>)}
                          </select>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex wrap" style={{ marginTop: 18 }}>
              <button className="btn btn-success" type="submit">Save Question Settings</button>
              <span className="small muted">Total selected across all categories/stages: {totalSelected}</span>
            </div>
          </form>
        </div>

        <div className="card card-pad" style={{ marginTop: 18 }}>
          <h2>Seed 15 questions per category</h2>
          <p className="muted">This inserts 15 seed questions for every category in the selected stage: 5 Algebra, 3 Aptitude, 4 Statistics and 3 Geometry. It skips questions that already exist, so it is safe to run again.</p>
          <div className="flex wrap">
            <label style={{ minWidth: 220 }}><span className="label">Stage to seed</span><select className="select" value={seedStage} onChange={e => setSeedStage(e.target.value)}>{CONTEST_STAGES.map(stage => <option key={stage}>{stage}</option>)}</select></label>
            <button className="btn btn-primary" type="button" onClick={seedQuestions}>Seed Questions for Selected Stage</button>
          </div>
        </div>
      </div>
    </main>
  );
}
