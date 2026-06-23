'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { APP_NAME } from '@/lib/constants';

const fallbackConfig = {
  welcomeTitle: 'Welcome to the Mezzopedia National Mathematics Contest',
  welcomeSubtitle: 'Ghana\'s mathematics champions start here.',
  welcomeBody: 'Read the instructions carefully, sign in with your unique code, and complete the test within the allowed time.',
  bannerImageUrl: '',
  activePhase: 'Stage 1'
};

export default function Home() {
  const [config, setConfig] = useState(fallbackConfig);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(json => setConfig({ ...fallbackConfig, ...(json.config || {}) }))
      .catch(() => null);
  }, []);

  return (
    <main className="math-bg">
      <div className="container">
        <nav className="nav flex between wrap no-print">
          <strong>{APP_NAME}</strong>
          <div className="flex wrap">
            <Link className="btn btn-light" href="/results">View Results</Link>
            <Link className="btn btn-light" href="/admin">Admin</Link>
          </div>
        </nav>

        <section className="centered">
          <div className="card card-pad" style={{ width: '100%' }}>
            <div className="grid grid-2" style={{ alignItems: 'center' }}>
              <div>
                <span className="badge">{config.activePhase || 'Contest Stage'}</span>
                <h1 style={{ marginTop: 16 }}>{config.welcomeTitle}</h1>
                <h2 className="muted" style={{ fontWeight: 600 }}>{config.welcomeSubtitle}</h2>
                <p>{config.welcomeBody}</p>
                <div className="flex wrap no-print" style={{ marginTop: 24 }}>
                  <Link className="btn btn-primary" href="/sign-in">Start / Continue Test</Link>
                  <Link className="btn btn-accent" href="/results">Check My Result</Link>
                </div>
              </div>
              <div>
                {config.bannerImageUrl ? (
                  <img src={config.bannerImageUrl} alt="Contest banner" className="banner-image" />
                ) : (
                  <div className="card card-pad" style={{ background: 'linear-gradient(135deg,#eef4ff,#fff8dd)', textAlign: 'center' }}>
                    <h2>π ∑ √ x² + y²</h2>
                    <p className="muted">A secure, timed national mathematics contest platform.</p>
                    <div style={{ fontSize: 80, fontWeight: 900, color: '#174ea6' }}>80</div>
                    <strong>Questions • 70 Minutes • One Attempt</strong>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
