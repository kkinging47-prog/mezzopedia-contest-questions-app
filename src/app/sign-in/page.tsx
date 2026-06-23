'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { DEFAULT_CATEGORIES } from '@/lib/constants';

export default function SignInPage() {
  const router = useRouter();
  const [category, setCategory] = useState(DEFAULT_CATEGORIES[0]);
  const [name, setName] = useState('');
  const [usercode, setUsercode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setName('');
    setUsercode('');
    setPassword('');
    fetch('/api/auth/participant/logout', { method: 'POST' }).catch(() => null);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/auth/participant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, name, usercode, password })
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok || !json.success) {
      setError(json.error || 'Could not sign in.');
      return;
    }
    setName('');
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
          <p className="muted">Enter your registered category, name, unique code and password. You can continue an unfinished test, but completed tests cannot be retaken.</p>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="grid">
            <label>
              <span className="label">Category</span>
              <select className="select" value={category} onChange={e => setCategory(e.target.value)}>
                {DEFAULT_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Name</span>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Your registered name" autoComplete="off" />
            </label>
            <label>
              <span className="label">Usercode</span>
              <input className="input" value={usercode} onChange={e => setUsercode(e.target.value)} placeholder="e.g. MZP-001" autoComplete="off" required />
            </label>
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
