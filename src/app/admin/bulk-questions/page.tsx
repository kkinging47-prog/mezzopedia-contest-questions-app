'use client';

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { CONTEST_STAGES, DEFAULT_CATEGORIES } from '@/lib/constants';

type ImageTarget = 'questionImageUrl' | 'optionAImageUrl' | 'optionBImageUrl' | 'optionCImageUrl' | 'optionDImageUrl';

type BulkQuestionRow = {
  questionNo: string;
  stage: string;
  category: string;
  topic: string;
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

const REQUIRED_HEADERS = [
  'question_no',
  'stage',
  'category',
  'topic',
  'question_text',
  'question_image_url',
  'option_a',
  'option_a_image_url',
  'option_b',
  'option_b_image_url',
  'option_c',
  'option_c_image_url',
  'option_d',
  'option_d_image_url',
  'correct_option_id',
  'explanation',
  'points',
  'is_active'
];

const TARGET_LABELS: Record<ImageTarget, string> = {
  questionImageUrl: 'Question image',
  optionAImageUrl: 'Option A image',
  optionBImageUrl: 'Option B image',
  optionCImageUrl: 'Option C image',
  optionDImageUrl: 'Option D image'
};

const IMPORT_BATCH_SIZE = 25;
const REQUEST_TIMEOUT_MS = 45000;

function keyName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readCell(row: Record<string, unknown>, candidates: string[]) {
  const map = new Map(Object.keys(row).map(key => [keyName(key), row[key]]));
  for (const candidate of candidates) {
    const value = map.get(keyName(candidate));
    if (value !== undefined && value !== null) return String(value).trim();
  }
  return '';
}

function normalizeCategory(value: string) {
  return DEFAULT_CATEGORIES.find(category => category.toLowerCase() === value.toLowerCase()) || value;
}

function normalizeStage(value: string) {
  return CONTEST_STAGES.find(stage => stage.toLowerCase() === value.toLowerCase()) || 'Stage 1';
}

function rowKey(row: BulkQuestionRow) {
  return `${row.category}|${row.stage}|${row.questionText.trim().toLowerCase()}`;
}

function normalizeRow(row: Record<string, unknown>, index: number): BulkQuestionRow {
  const activeRaw = readCell(row, ['is_active', 'active', 'status']);
  return {
    questionNo: readCell(row, ['question_no', 'question number', 'no', 'number']) || String(index + 1),
    stage: normalizeStage(readCell(row, ['stage', 'phase']) || 'Stage 1'),
    category: normalizeCategory(readCell(row, ['category', 'class', 'level'])),
    topic: readCell(row, ['topic', 'question_topic', 'strand']),
    questionText: readCell(row, ['question_text', 'question', 'question text']),
    questionImageUrl: readCell(row, ['question_image_url', 'question image url', 'question_image']),
    optionA: readCell(row, ['option_a', 'option a', 'a']),
    optionAImageUrl: readCell(row, ['option_a_image_url', 'option a image url', 'a image']),
    optionB: readCell(row, ['option_b', 'option b', 'b']),
    optionBImageUrl: readCell(row, ['option_b_image_url', 'option b image url', 'b image']),
    optionC: readCell(row, ['option_c', 'option c', 'c']),
    optionCImageUrl: readCell(row, ['option_c_image_url', 'option c image url', 'c image']),
    optionD: readCell(row, ['option_d', 'option d', 'd']),
    optionDImageUrl: readCell(row, ['option_d_image_url', 'option d image url', 'd image']),
    correctOptionId: (readCell(row, ['correct_option_id', 'correct option', 'answer', 'correct_answer']) || 'A').toUpperCase(),
    explanation: readCell(row, ['explanation', 'solution', 'working']),
    points: Math.max(1, Number(readCell(row, ['points', 'marks']) || 1) || 1),
    isActive: !['false', 'no', '0', 'inactive'].includes(activeRaw.toLowerCase())
  };
}

function validateRows(rows: BulkQuestionRow[]) {
  const errors: string[] = [];
  rows.forEach(row => {
    if (!row.category) errors.push(`Question ${row.questionNo}: category is missing.`);
    if (!DEFAULT_CATEGORIES.includes(row.category)) errors.push(`Question ${row.questionNo}: category must match the app categories.`);
    if (!row.questionText) errors.push(`Question ${row.questionNo}: question_text is missing.`);
    if (!['A', 'B', 'C', 'D'].includes(row.correctOptionId)) errors.push(`Question ${row.questionNo}: correct_option_id must be A, B, C or D.`);
    const optionCount = [row.optionA || row.optionAImageUrl, row.optionB || row.optionBImageUrl, row.optionC || row.optionCImageUrl, row.optionD || row.optionDImageUrl].filter(Boolean).length;
    if (optionCount < 2) errors.push(`Question ${row.questionNo}: at least two answer options are required.`);
  });
  return errors;
}

function duplicateRows(rows: BulkQuestionRow[]) {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const row of rows) {
    const key = rowKey(row);
    if (seen.has(key)) duplicates.push(row.questionNo || row.questionText.slice(0, 40));
    seen.add(key);
  }
  return duplicates;
}

function chunkRows(rows: BulkQuestionRow[], size: number) {
  const chunks: BulkQuestionRow[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

async function postBatch(batch: BulkQuestionRow[], batchNumber: number, totalBatches: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch('/api/admin/questions/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: batch, batchNumber, totalBatches }),
      signal: controller.signal
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json };
  } finally {
    window.clearTimeout(timer);
  }
}

export default function BulkQuestionUploadPage() {
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<BulkQuestionRow[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [imageQuestionNo, setImageQuestionNo] = useState('');
  const [imageTarget, setImageTarget] = useState<ImageTarget>('questionImageUrl');

  const validationErrors = useMemo(() => validateRows(rows).slice(0, 15), [rows]);

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) throw new Error('Admin login required.');
      setReady(true);
    }).catch(err => setError(err.message || 'Could not verify admin session.'));
  }, []);

  function downloadTemplate() {
    const sample = [
      {
        question_no: '001',
        stage: 'Stage 1',
        category: 'Primary 6',
        topic: 'Fractions',
        question_text: 'What is 1/2 + 1/4?',
        question_image_url: '',
        option_a: '1/4',
        option_a_image_url: '',
        option_b: '3/4',
        option_b_image_url: '',
        option_c: '1/2',
        option_c_image_url: '',
        option_d: '1',
        option_d_image_url: '',
        correct_option_id: 'B',
        explanation: 'Convert 1/2 to 2/4, then 2/4 + 1/4 = 3/4.',
        points: 1,
        is_active: 'TRUE'
      },
      {
        question_no: '002',
        stage: 'Final Trial',
        category: 'JHS 1',
        topic: 'Geometry',
        question_text: 'Use the diagram to find the missing angle.',
        question_image_url: '',
        option_a: '40°',
        option_a_image_url: '',
        option_b: '50°',
        option_b_image_url: '',
        option_c: '60°',
        option_c_image_url: '',
        option_d: '70°',
        option_d_image_url: '',
        correct_option_id: 'C',
        explanation: 'Angles on a straight line add up to 180°.',
        points: 1,
        is_active: 'TRUE'
      }
    ];
    const worksheet = XLSX.utils.json_to_sheet(sample, { header: REQUIRED_HEADERS });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Questions');
    XLSX.writeFile(workbook, 'mezzopedia-bulk-question-template.xlsx');
  }

  async function parseExcel(file: File | null) {
    if (!file) return;
    setMessage('');
    setError('');
    setImportProgress('');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
    const parsed = raw.map((row, index) => normalizeRow(row, index)).filter(row => row.questionText || row.category || row.optionA || row.optionB);
    setRows(parsed);
    setImageQuestionNo(parsed[0]?.questionNo || '');
    setMessage(`Loaded ${parsed.length} question row(s) from Excel. Review them before importing.`);
  }

  async function uploadImage(file: File | null) {
    if (!file || !imageQuestionNo) return;
    setUploading(true);
    setError('');
    setMessage('Uploading image...');
    const form = new FormData();
    form.append('file', file);
    form.append('folder', 'bulk-question-images');
    const res = await fetch('/api/admin/upload', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    setUploading(false);
    if (!res.ok) { setError(json.error || 'Image upload failed.'); setMessage(''); return; }

    setRows(prev => prev.map(row => row.questionNo === imageQuestionNo ? { ...row, [imageTarget]: json.url } : row));
    setMessage(`${TARGET_LABELS[imageTarget]} uploaded and attached to question ${imageQuestionNo}.`);
  }

  async function importQuestions() {
    setError('');
    setMessage('');
    setImportProgress('Preparing import...');

    const errors = validateRows(rows);
    if (errors.length) { setError(errors.slice(0, 12).join(' | ')); setImportProgress(''); return; }

    const duplicateQuestionNumbers = duplicateRows(rows);
    if (duplicateQuestionNumbers.length) {
      setError(`Duplicate questions were found inside this Excel file at question number(s): ${duplicateQuestionNumbers.slice(0, 20).join(', ')}. Remove duplicate question text for the same category/stage, then upload again.`);
      setImportProgress('');
      return;
    }

    const batches = chunkRows(rows, IMPORT_BATCH_SIZE);
    let inserted = 0;
    let skipped = 0;
    let note = '';

    setSaving(true);
    try {
      for (let index = 0; index < batches.length; index += 1) {
        const batchNumber = index + 1;
        setImportProgress(`Importing batch ${batchNumber} of ${batches.length}... ${inserted} inserted so far.`);
        const result = await postBatch(batches[index], batchNumber, batches.length);
        if (!result.ok) {
          setError(result.json?.error || `Import failed on batch ${batchNumber}.`);
          setImportProgress(`Stopped at batch ${batchNumber} of ${batches.length}. Inserted ${inserted}; skipped ${skipped}.`);
          return;
        }
        inserted += Number(result.json?.inserted || 0);
        skipped += Number(result.json?.skipped || 0);
        if (result.json?.note) note = result.json.note;
      }

      setMessage(`Import complete. Inserted ${inserted}; skipped duplicates ${skipped}.${note}`);
      setImportProgress(`Finished ${batches.length} batch(es). You can now check Questions Filter.`);
    } catch (err: any) {
      const aborted = err?.name === 'AbortError';
      setError(aborted ? 'The import request took too long and was stopped before the browser waited forever. Try importing again; the system will skip questions already inserted.' : 'The import failed because the browser lost connection. Try again; already inserted questions will be skipped.');
      setImportProgress(`Interrupted. Inserted ${inserted}; skipped ${skipped}.`);
    } finally {
      setSaving(false);
    }
  }

  function clearRows() {
    setRows([]);
    setImageQuestionNo('');
    setImportProgress('');
    setMessage('Cleared loaded questions.');
  }

  if (!ready && error) return <main className="math-bg centered"><div className="card card-pad"><div className="alert alert-error">{error}</div><a className="btn btn-primary" href="/admin">Back to Admin</a></div></main>;

  return (
    <main className="math-bg" style={{ padding: '24px 0 80px' }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Bulk Questions Upload</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin/question-settings">Question Settings</a>
            <a className="btn btn-light" href="/admin/questions">Questions Filter</a>
            <a className="btn btn-primary" href="/admin">Back to Admin</a>
          </div>
        </nav>

        <section className="card card-pad">
          <span className="badge">Excel format</span>
          <h1 style={{ marginTop: 12 }}>Upload questions in bulk</h1>
          <p className="muted">Use the template below so the system can read category, stage, topic, question text, options, correct answer and image links accurately.</p>
          {message && <div className="alert alert-success">{message}</div>}
          {error && <div className="alert alert-error">{error}</div>}
          {importProgress && <div className="alert alert-info">{importProgress}</div>}

          <div className="grid grid-2 no-print">
            <button className="btn btn-success" type="button" onClick={downloadTemplate}>Download Excel Template</button>
            <label><span className="label">Upload completed Excel file</span><input type="file" accept=".xlsx,.xls" onChange={e => parseExcel(e.target.files?.[0] || null)} disabled={saving} /></label>
          </div>

          <div className="alert alert-info" style={{ marginTop: 14 }}>
            Imports now run in small safe batches of {IMPORT_BATCH_SIZE}. Do not refresh while it is importing. If the internet cuts off, upload the same file again; already imported questions will be skipped.
          </div>

          <div className="table-wrap" style={{ marginTop: 18 }}>
            <table>
              <thead><tr><th>Column</th><th>Required?</th><th>Example</th><th>Meaning</th></tr></thead>
              <tbody>
                <FormatRow name="question_no" required="Yes" example="001" meaning="Unique number used to attach uploaded images to the right question." />
                <FormatRow name="stage" required="Yes" example="Final Trial / Stage 1" meaning="Final Trial, Stage 1, Stage 2 or Stage 3." />
                <FormatRow name="category" required="Yes" example="Primary 6" meaning="Must match one of the app categories exactly." />
                <FormatRow name="topic" required="Recommended" example="Fractions" meaning="The topic/strand for tracking and review." />
                <FormatRow name="question_text" required="Yes" example="What is 1/2 + 1/4?" meaning="The full question text." />
                <FormatRow name="question_image_url" required="Optional" example="Auto-filled after image upload" meaning="Image for the main question/diagram." />
                <FormatRow name="option_a, option_b, option_c, option_d" required="At least 2" example="3/4" meaning="Answer option text." />
                <FormatRow name="option_a_image_url ... option_d_image_url" required="Optional" example="Auto-filled after image upload" meaning="Image for answer options that require diagrams." />
                <FormatRow name="correct_option_id" required="Yes" example="B" meaning="Correct answer: A, B, C or D." />
                <FormatRow name="explanation" required="Optional" example="Convert 1/2 to 2/4..." meaning="Solution/explanation for admin review." />
                <FormatRow name="points" required="Optional" example="1" meaning="Marks for the question. Defaults to 1." />
                <FormatRow name="is_active" required="Optional" example="TRUE" meaning="TRUE/FALSE. Only active questions are used in tests." />
              </tbody>
            </table>
          </div>
        </section>

        {!!rows.length && <section className="card card-pad" style={{ marginTop: 18 }}>
          <h2>Attach images by question number</h2>
          <p className="muted">Select the question number from the Excel file, choose whether the image belongs to the main question or an option, then upload the image. The system will save the image URL into that question row before import.</p>
          <div className="grid grid-3 no-print">
            <label><span className="label">Question number</span><select className="select" value={imageQuestionNo} onChange={e => setImageQuestionNo(e.target.value)}>{rows.map(row => <option key={row.questionNo} value={row.questionNo}>{row.questionNo}</option>)}</select></label>
            <label><span className="label">Image target</span><select className="select" value={imageTarget} onChange={e => setImageTarget(e.target.value as ImageTarget)}>{Object.entries(TARGET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span className="label">Upload image</span><input type="file" accept="image/*" disabled={uploading || saving} onChange={e => uploadImage(e.target.files?.[0] || null)} /></label>
          </div>
        </section>}

        {!!validationErrors.length && <div className="alert alert-error">{validationErrors.join(' | ')}</div>}

        {!!rows.length && <section className="card card-pad" style={{ marginTop: 18 }}>
          <div className="flex between wrap no-print">
            <div><h2>Review loaded questions</h2><p className="muted">Loaded {rows.length} question(s). Confirm before importing.</p></div>
            <div className="flex wrap"><button className="btn btn-light" onClick={clearRows} disabled={saving}>Clear</button><button className="btn btn-primary" onClick={importQuestions} disabled={saving || !!validationErrors.length}>{saving ? 'Importing...' : 'Import Questions'}</button></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>No.</th><th>Stage</th><th>Category</th><th>Topic</th><th>Question</th><th>Images</th><th>Correct</th></tr></thead>
              <tbody>{rows.map(row => <tr key={`${row.questionNo}-${row.questionText}`}>
                <td>{row.questionNo}</td>
                <td>{row.stage}</td>
                <td>{row.category}</td>
                <td>{row.topic}</td>
                <td><strong>{row.questionText}</strong><br /><span className="small muted">A: {row.optionA || 'image'} | B: {row.optionB || 'image'} | C: {row.optionC || 'image'} | D: {row.optionD || 'image'}</span></td>
                <td className="small">{row.questionImageUrl ? 'Question ✓ ' : ''}{row.optionAImageUrl ? 'A ✓ ' : ''}{row.optionBImageUrl ? 'B ✓ ' : ''}{row.optionCImageUrl ? 'C ✓ ' : ''}{row.optionDImageUrl ? 'D ✓ ' : ''}</td>
                <td>{row.correctOptionId}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>}
      </div>
    </main>
  );
}

function FormatRow({ name, required, example, meaning }: { name: string; required: string; example: string; meaning: string }) {
  return <tr><td><code>{name}</code></td><td>{required}</td><td>{example}</td><td>{meaning}</td></tr>;
}
