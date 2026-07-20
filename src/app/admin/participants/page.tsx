'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CONTEST_STAGES, DEFAULT_CATEGORIES, FINAL_TRIAL_STAGE, PAYMENT_STATUSES } from '@/lib/constants';

type Participant = {
  id: string;
  name: string;
  usercode: string;
  category: string;
  payment_status: string;
  contest_stage?: string;
  is_active: boolean;
  login_count: number;
  last_login_at?: string | null;
  created_at?: string;
};

type ParticipantForm = {
  category: string;
  name: string;
  usercode: string;
  password: string;
  paymentStatus: string;
  contestStage: string;
  isActive: boolean;
};

const emptyForm = (): ParticipantForm => ({
  category: DEFAULT_CATEGORIES[0],
  name: '',
  usercode: '',
  password: '',
  paymentStatus: 'unpaid',
  contestStage: FINAL_TRIAL_STAGE,
  isActive: true
});

function codeKey(value: string) {
  return value.trim().toLowerCase();
}

export default function ParticipantsManagerPage() {
  const [ready, setReady] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [stageFilter, setStageFilter] = useState('All');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newForm, setNewForm] = useState<ParticipantForm>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ParticipantForm>(emptyForm());

  const filteredParticipants = useMemo(() => {
    const q = search.trim().toLowerCase();
    return participants.filter(participant => {
      const searchOk = !q || [participant.name, participant.usercode, participant.category, participant.payment_status, participant.contest_stage].some(value => String(value || '').toLowerCase().includes(q));
      const categoryOk = categoryFilter === 'All' || participant.category === categoryFilter;
      const paymentOk = paymentFilter === 'All' || participant.payment_status === paymentFilter;
      const stageOk = stageFilter === 'All' || (participant.contest_stage || 'Stage 1') === stageFilter;
      return searchOk && categoryOk && paymentOk && stageOk;
    });
  }, [participants, search, categoryFilter, paymentFilter, stageFilter]);

  const duplicateCodes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const participant of participants) counts.set(codeKey(participant.usercode), (counts.get(codeKey(participant.usercode)) || 0) + 1);
    return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([code]) => code);
  }, [participants]);

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) throw new Error('Admin login required.');
      setReady(true);
      return loadParticipants();
    }).catch(err => {
      setError(err.message || 'Could not verify admin session.');
      setLoading(false);
    });
  }, []);

  async function loadParticipants() {
    setLoading(true);
    setMessage('Loading participants...');
    const json = await fetch('/api/admin/participants').then(res => res.json()).catch(() => ({}));
    setLoading(false);
    if (json.error) { setError(json.error); setMessage(''); return; }
    setParticipants(json.participants || []);
    setMessage('');
  }

  function findDuplicate(usercode: string, excludeId?: string | null) {
    const key = codeKey(usercode);
    if (!key) return null;
    return participants.find(item => codeKey(item.usercode) === key && item.id !== excludeId) || null;
  }

  function startEdit(participant: Participant) {
    setEditingId(participant.id);
    setEditForm({
      category: participant.category,
      name: participant.name,
      usercode: participant.usercode,
      password: '',
      paymentStatus: participant.payment_status || 'unpaid',
      contestStage: participant.contest_stage || FINAL_TRIAL_STAGE,
      isActive: Boolean(participant.is_active)
    });
    setMessage(`Editing ${participant.name}. Leave password blank if you do not want to change it.`);
    setError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyForm());
    setMessage('');
  }

  async function addParticipant(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');

    const duplicate = findDuplicate(newForm.usercode);
    if (duplicate) {
      const openExisting = confirm(`Duplicate code found: ${duplicate.usercode} already belongs to ${duplicate.name} (${duplicate.category}).\n\nClick OK to open the existing participant for editing, or Cancel to stop.`);
      if (openExisting) {
        setSearch(duplicate.usercode);
        startEdit(duplicate);
      }
      return;
    }

    setLoading(true);
    const res = await fetch('/api/admin/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newForm)
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      if (json.duplicate && Array.isArray(json.duplicates)) {
        const existing = json.duplicates[0];
        setError(`${json.error} Existing record: ${existing?.name || ''} ${existing?.category ? `(${existing.category})` : ''}`);
        setSearch(existing?.usercode || newForm.usercode);
        return;
      }
      setError(json.error || 'Could not add participant.');
      return;
    }
    setNewForm(emptyForm());
    setMessage('Participant added successfully.');
    loadParticipants();
  }

  async function saveEdit() {
    if (!editingId) return;
    setError('');
    setMessage('');

    const duplicate = findDuplicate(editForm.usercode, editingId);
    if (duplicate) {
      setError(`Duplicate code found: ${duplicate.usercode} already belongs to ${duplicate.name} (${duplicate.category}). Choose another code before saving.`);
      return;
    }

    const payload: Record<string, unknown> = {
      category: editForm.category,
      name: editForm.name,
      usercode: editForm.usercode,
      paymentStatus: editForm.paymentStatus,
      contestStage: editForm.contestStage,
      isActive: editForm.isActive
    };
    if (editForm.password.trim()) payload.password = editForm.password.trim();

    setLoading(true);
    const res = await fetch(`/api/admin/participants/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(json.error || 'Could not update participant.'); return; }
    setEditingId(null);
    setEditForm(emptyForm());
    setMessage('Participant updated successfully.');
    loadParticipants();
  }

  async function deleteParticipant(participant: Participant) {
    if (!confirm(`Delete ${participant.name} (${participant.usercode})? This cannot be undone.`)) return;
    setLoading(true);
    const res = await fetch(`/api/admin/participants/${participant.id}`, { method: 'DELETE' });
    setLoading(false);
    if (!res.ok) { setError('Delete failed.'); return; }
    setMessage('Participant deleted.');
    if (editingId === participant.id) cancelEdit();
    loadParticipants();
  }

  async function quickPayment(participant: Participant, paymentStatus: string) {
    const res = await fetch(`/api/admin/participants/${participant.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentStatus })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || 'Could not update payment status.'); return; }
    setMessage(`${participant.name}'s payment status changed to ${paymentStatus}.`);
    loadParticipants();
  }

  if (error && !ready && !loading) {
    return <main className="math-bg centered"><div className="card card-pad"><div className="alert alert-error">{error}</div><a className="btn btn-primary" href="/admin">Back to Admin</a></div></main>;
  }

  return (
    <main className="math-bg" style={{ paddingBottom: 40 }}>
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>Participant Manager</strong>
          <div className="flex wrap">
            <a className="btn btn-light" href="/admin">Back to Admin</a>
            <a className="btn btn-primary" href="/admin/participants-import">Excel Import</a>
            <button className="btn btn-light" onClick={loadParticipants} disabled={loading}>Refresh</button>
          </div>
        </nav>

        {message && <div className="alert alert-success">{message}</div>}
        {error && ready && <div className="alert alert-error">{error}</div>}
        {!!duplicateCodes.length && <div className="alert alert-error">Duplicate usercodes already exist in the database: {duplicateCodes.slice(0, 12).join(', ')}{duplicateCodes.length > 12 ? '...' : ''}. Edit/delete duplicates so student sign-in can auto-detect category correctly.</div>}

        <section className="card card-pad grid">
          <div>
            <span className="badge">Search and edit participants</span>
            <h1 style={{ marginTop: 12 }}>Manage participant records</h1>
            <p className="muted">Search by name or code, edit category, payment status, assigned stage, access and password. New codes are checked for duplicates before saving.</p>
          </div>

          <form className="grid grid-3" onSubmit={addParticipant} autoComplete="off">
            <Dropdown label="Category" value={newForm.category} options={DEFAULT_CATEGORIES} onChange={category => setNewForm(prev => ({ ...prev, category }))} />
            <Field label="Name" value={newForm.name} onChange={name => setNewForm(prev => ({ ...prev, name }))} required />
            <Field label="Usercode" value={newForm.usercode} onChange={usercode => setNewForm(prev => ({ ...prev, usercode }))} required />
            <Field label="Password" value={newForm.password} onChange={password => setNewForm(prev => ({ ...prev, password }))} required />
            <Dropdown label="Payment Status" value={newForm.paymentStatus} options={PAYMENT_STATUSES as unknown as string[]} onChange={paymentStatus => setNewForm(prev => ({ ...prev, paymentStatus }))} />
            <Dropdown label="Assigned Stage" value={newForm.contestStage} options={CONTEST_STAGES as unknown as string[]} onChange={contestStage => setNewForm(prev => ({ ...prev, contestStage }))} />
            <label><span className="label">Access</span><select className="select" value={newForm.isActive ? 'Open' : 'Closed'} onChange={e => setNewForm(prev => ({ ...prev, isActive: e.target.value === 'Open' }))}><option>Open</option><option>Closed</option></select></label>
            <button className="btn btn-primary" style={{ alignSelf: 'end' }} disabled={loading}>{loading ? 'Saving...' : 'Add Participant'}</button>
          </form>
        </section>

        <section className="card card-pad" style={{ marginTop: 18 }}>
          <div className="grid grid-4 no-print">
            <label><span className="label">Search name/code/category</span><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Type name or usercode" /></label>
            <Dropdown label="Category" value={categoryFilter} options={['All', ...DEFAULT_CATEGORIES]} onChange={setCategoryFilter} />
            <Dropdown label="Payment" value={paymentFilter} options={['All', ...(PAYMENT_STATUSES as unknown as string[])]} onChange={setPaymentFilter} />
            <Dropdown label="Stage" value={stageFilter} options={['All', ...(CONTEST_STAGES as unknown as string[])]} onChange={setStageFilter} />
          </div>
          <div className="grid grid-4" style={{ marginTop: 18 }}>
            <Metric title="Total Participants" value={String(participants.length)} />
            <Metric title="Showing" value={String(filteredParticipants.length)} />
            <Metric title="Paid" value={String(participants.filter(p => p.payment_status === 'paid').length)} />
            <Metric title="Pending/Unpaid" value={String(participants.filter(p => p.payment_status !== 'paid').length)} />
          </div>
        </section>

        {editingId && <section className="card card-pad grid" style={{ marginTop: 18, border: '1px solid rgba(37,99,235,0.25)' }}>
          <h2>Edit participant</h2>
          <div className="grid grid-3">
            <Dropdown label="Category" value={editForm.category} options={DEFAULT_CATEGORIES} onChange={category => setEditForm(prev => ({ ...prev, category }))} />
            <Field label="Name" value={editForm.name} onChange={name => setEditForm(prev => ({ ...prev, name }))} required />
            <Field label="Usercode" value={editForm.usercode} onChange={usercode => setEditForm(prev => ({ ...prev, usercode }))} required />
            <Field label="New Password" value={editForm.password} onChange={password => setEditForm(prev => ({ ...prev, password }))} placeholder="Leave blank to keep old password" />
            <Dropdown label="Payment Status" value={editForm.paymentStatus} options={PAYMENT_STATUSES as unknown as string[]} onChange={paymentStatus => setEditForm(prev => ({ ...prev, paymentStatus }))} />
            <Dropdown label="Assigned Stage" value={editForm.contestStage} options={CONTEST_STAGES as unknown as string[]} onChange={contestStage => setEditForm(prev => ({ ...prev, contestStage }))} />
            <label><span className="label">Access</span><select className="select" value={editForm.isActive ? 'Open' : 'Closed'} onChange={e => setEditForm(prev => ({ ...prev, isActive: e.target.value === 'Open' }))}><option>Open</option><option>Closed</option></select></label>
          </div>
          <div className="flex wrap no-print"><button className="btn btn-primary" onClick={saveEdit} disabled={loading}>Save Changes</button><button className="btn btn-light" onClick={cancelEdit}>Cancel</button></div>
        </section>}

        <section className="card card-pad" style={{ marginTop: 18 }}>
          {loading && <div className="alert alert-info">Working...</div>}
          {!loading && !filteredParticipants.length && <div className="alert alert-info">No participant matched your filter.</div>}
          {!!filteredParticipants.length && <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Code</th><th>Category</th><th>Payment</th><th>Stage</th><th>Access</th><th>Logins</th><th>Last Login</th><th>Actions</th></tr></thead>
            <tbody>{filteredParticipants.map(participant => <tr key={participant.id}>
              <td>{participant.name}</td>
              <td><strong>{participant.usercode}</strong></td>
              <td>{participant.category}</td>
              <td><strong>{participant.payment_status}</strong><div className="flex wrap no-print" style={{ marginTop: 6 }}><button className="btn btn-light" onClick={() => quickPayment(participant, 'paid')}>Paid</button><button className="btn btn-light" onClick={() => quickPayment(participant, 'pending')}>Pending</button><button className="btn btn-light" onClick={() => quickPayment(participant, 'unpaid')}>Unpaid</button></div></td>
              <td>{participant.contest_stage || 'Stage 1'}</td>
              <td>{participant.is_active ? 'Open' : 'Closed'}</td>
              <td>{participant.login_count || 0}</td>
              <td>{participant.last_login_at ? new Date(participant.last_login_at).toLocaleString() : ''}</td>
              <td><div className="flex wrap no-print"><button className="btn btn-primary" onClick={() => startEdit(participant)}>Edit</button><button className="btn btn-danger" onClick={() => deleteParticipant(participant)}>Delete</button></div></td>
            </tr>)}</tbody>
          </table></div>}
        </section>
      </div>
    </main>
  );
}

function Field({ label, value, onChange, required, placeholder }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; placeholder?: string }) {
  return <label><span className="label">{label}</span><input className="input" value={value} onChange={e => onChange(e.target.value)} autoComplete="off" required={required} placeholder={placeholder} /></label>;
}

function Dropdown({ label, value, options, onChange }: { label: string; value: string; options: string[] | readonly string[]; onChange: (value: string) => void }) {
  return <label><span className="label">{label}</span><select className="select" value={value} onChange={e => onChange(e.target.value)}>{options.map(option => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function Metric({ title, value }: { title: string; value: string }) {
  return <div className="card card-pad" style={{ boxShadow: 'none', textAlign: 'center' }}><div className="muted small">{title}</div><h2>{value}</h2></div>;
}
