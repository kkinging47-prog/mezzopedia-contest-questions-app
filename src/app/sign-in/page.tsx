'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type CodeLookup = {
  name: string;
  usercode: string;
  category: string;
  paymentStatus: string;
  contestStage: string;
  isActive: boolean;
};

export default function SignInPage() {
  const router = useRouter();
  const [participant, setParticipant] = useState<CodeLookup | null>(null);
  const [usercode, setUsercode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [error, setError] = useState('');
  const [lookupMessage, setLookupMessage] = useState('');

  useEffect(() => {
    setUsercode('');
    setPassword('');
    fetch('/api/auth/participant/logout', { method: 'POST' }).catch(() => null);
  }, []);

  async function lookupCode(code = usercode) {
    const cleanCode = code.trim();
    setParticipant(null);
    setLookupMessage('');
    if (cleanCode.length < 3) return;

    setLookupLoading(true);
    const res = await fetch('/api/auth/participant/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usercode: cleanCode })
    });
    const json = await res.json().catch(() => ({}));
    setLookupLoading(false);

    if (!res.ok || !json.success) {
      setLookupMessage(json.error || 'Code not found yet. Check the code and try again.');
      return;
    }
    setParticipant(json.participant);
    setLookupMessage('Code found. Confirm your name and enter your password.');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/auth/participant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usercode, password })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok || !json.success) {
      setError(json.error || 'Could not sign in.');
      return;
    }
    setUsercode('');
    setPassword('');
    router.push('/test');
  }

  return (
    <main className="math-bg centered">
      <div className="container" style={{ maxWidth: 560 }}>
        <form className="card card-pad" onSubmit={submit} autoComplete="off">
          <Link href="/" className="badge no-print">← Back to Home</Link>
          <h1 style={{ fontSize: '2.2rem', marginTop: 18 }}>Participant Sign In</h1>
          <p className="muted">Enter only your unique code and password. The system will automatically find your name, category and assigned stage.</p>

          {error && <div className="alert alert-error">{error}</div>}
          {lookupMessage && <div className={participant ? 'alert alert-success' : 'alert alert-info'}>{lookupMessage}</div>}

          <div className="grid">
            <label>
              <span className="label">Usercode</span>
              <div className="flex">
                <input
                  className="input"
                  value={usercode}
                  onChange={e => { setUsercode(e.target.value); setParticipant(null); setLookupMessage(''); }}
                  onBlur={() => lookupCode()}
                  placeholder="e.g. MZP-001"
                  autoComplete="off"
                  required
                />
                <button type="button" className="btn btn-light" onClick={() => lookupCode()} disabled={lookupLoading || !usercode.trim()}>{lookupLoading ? 'Checking...' : 'Check'}</button>
              </div>
            </label>

            {participant && <div className="card card-pad" style={{ boxShadow: 'none', background: '#f7f9fd' }}>
              <strong>{participant.name}</strong>
              <p className="small muted" style={{ margin: '6px 0 0' }}>Category: {participant.category}<br />Assigned stage: {participant.contestStage}<br />Payment: {participant.paymentStatus}</p>
              {participant.paymentStatus !== 'paid' && participant.contestStage !== 'Final Trial' && <div className="alert alert-error" style={{ marginTop: 10 }}>Payment is not confirmed. You can use Final Trial, but the main contest stages require paid status.</div>}
            </div>}

            <label>
              <span className="label">Password</span>
              <div className="flex">
                <input className="input" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" autoComplete="new-password" required />
                <button type="button" className="btn btn-light" onClick={() => setShowPassword(v => !v)}>{showPassword ? 'Hide' : 'View'}</button>
              </div>
            </label>
          </div>

          <button className="btn btn-primary" style={{ width: '100%', marginTop: 20 }} disabled={loading}>
            {loading ? 'Checking details...' : 'Proceed to Test'}
          </button>
        </form>
      </div>
    </main>
  );
}
