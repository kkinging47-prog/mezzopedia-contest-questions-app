'use client';

import { FormEvent, useEffect, useState } from 'react';
import { DEFAULT_RUNTIME_SETTINGS } from '@/lib/runtimeSettings';

type Settings = typeof DEFAULT_RUNTIME_SETTINGS;

type ConfigRow = { key: string; value: unknown };

function parseSettings(value: unknown): Settings {
  if (!value) return DEFAULT_RUNTIME_SETTINGS;
  if (typeof value === 'string') {
    try { return { ...DEFAULT_RUNTIME_SETTINGS, ...JSON.parse(value) }; } catch { return DEFAULT_RUNTIME_SETTINGS; }
  }
  if (typeof value === 'object') return { ...DEFAULT_RUNTIME_SETTINGS, ...(value as Record<string, unknown>) } as Settings;
  return DEFAULT_RUNTIME_SETTINGS;
}

export default function PerformancePage() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_RUNTIME_SETTINGS);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) throw new Error('Admin login required.');
      return fetch('/api/admin/config');
    }).then(async res => {
      const json = await res.json();
      const row = (json.config || []).find((item: ConfigRow) => item.key === 'runtimeSettings');
      setSettings(parseSettings(row?.value));
      setReady(true);
    }).catch(err => setError(err.message || 'Could not load performance settings.'));
  }, []);

  function setNumber(key: keyof Settings, value: string) {
    setSettings(prev => ({ ...prev, [key]: Number(value) }));
  }

  function setBool(key: keyof Settings, value: boolean) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  function applySafe400Preset() {
    setSettings({
      contestLoadMode: true,
      answerSaveDelayMs: 1500,
      snapshotMs: 45000,
      cameraCheckMs: 12000,
      audioCheckMs: 3500,
      panelCheckMs: 10000,
      cooldownMs: 30000,
      imageQuality: 0.45,
      maxImageWidth: 540,
      audioClipMs: 3000,
      requireDesktopScreen: true,
      reducedMobileMode: true
    });
  }

  function applyLightPreset() {
    setSettings({
      contestLoadMode: true,
      answerSaveDelayMs: 2000,
      snapshotMs: 60000,
      cameraCheckMs: 20000,
      audioCheckMs: 6000,
      panelCheckMs: 15000,
      cooldownMs: 60000,
      imageQuality: 0.35,
      maxImageWidth: 420,
      audioClipMs: 2500,
      requireDesktopScreen: true,
      reducedMobileMode: true
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setError('');
    const res = await fetch('/api/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { runtimeSettings: settings } })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || 'Could not save settings.'); return; }
    setMessage('Performance settings saved. Vercel does not need a redeploy for these settings. New test pages will use them automatically.');
  }

  if (error && !ready) return <main className="math-bg centered"><div className="card card-pad"><div className="alert alert-error">{error}</div><a className="btn btn-primary" href="/admin">Back to Admin</a></div></main>;

  return (
    <main className="math-bg" style={{ padding: '24px 0 80px' }}>
      <div className="container">
        <nav className="nav flex between wrap">
          <strong>Contest Stability</strong>
          <a className="btn btn-light" href="/admin">Back to Admin</a>
        </nav>
        <div className="card card-pad">
          <span className="badge">400-user readiness</span>
          <h1 style={{ marginTop: 12 }}>Performance controls</h1>
          <p className="muted">Use these settings before a live contest day. For 400 simultaneous candidates, keep answer saving batched and avoid very frequent image/audio uploads.</p>
          {message && <div className="alert alert-success">{message}</div>}
          {error && <div className="alert alert-error">{error}</div>}
          <div className="flex wrap" style={{ marginBottom: 18 }}>
            <button className="btn btn-primary" type="button" onClick={applySafe400Preset}>Use Safe 400-user Preset</button>
            <button className="btn btn-light" type="button" onClick={applyLightPreset}>Use Lighter Mobile Preset</button>
          </div>

          <form onSubmit={save} className="grid grid-2">
            <label><span className="label">Answer save delay (ms)</span><input className="input" type="number" min="500" max="5000" value={settings.answerSaveDelayMs} onChange={e => setNumber('answerSaveDelayMs', e.target.value)} /></label>
            <label><span className="label">Snapshot interval (ms)</span><input className="input" type="number" min="15000" max="120000" value={settings.snapshotMs} onChange={e => setNumber('snapshotMs', e.target.value)} /></label>
            <label><span className="label">Camera check interval (ms)</span><input className="input" type="number" min="5000" max="60000" value={settings.cameraCheckMs} onChange={e => setNumber('cameraCheckMs', e.target.value)} /></label>
            <label><span className="label">Audio check interval (ms)</span><input className="input" type="number" min="2000" max="30000" value={settings.audioCheckMs} onChange={e => setNumber('audioCheckMs', e.target.value)} /></label>
            <label><span className="label">Panel/window check interval (ms)</span><input className="input" type="number" min="5000" max="60000" value={settings.panelCheckMs} onChange={e => setNumber('panelCheckMs', e.target.value)} /></label>
            <label><span className="label">Evidence cooldown (ms)</span><input className="input" type="number" min="10000" max="180000" value={settings.cooldownMs} onChange={e => setNumber('cooldownMs', e.target.value)} /></label>
            <label><span className="label">Image width</span><input className="input" type="number" min="320" max="900" value={settings.maxImageWidth} onChange={e => setNumber('maxImageWidth', e.target.value)} /></label>
            <label><span className="label">Audio clip length (ms)</span><input className="input" type="number" min="1500" max="10000" value={settings.audioClipMs} onChange={e => setNumber('audioClipMs', e.target.value)} /></label>
            <label><span className="label">Image quality</span><input className="input" type="number" min="0.25" max="0.75" step="0.05" value={settings.imageQuality} onChange={e => setNumber('imageQuality', e.target.value)} /></label>
            <label><span className="label">Contest load mode</span><select className="select" value={String(settings.contestLoadMode)} onChange={e => setBool('contestLoadMode', e.target.value === 'true')}><option value="true">On</option><option value="false">Off</option></select></label>
            <label><span className="label">Require desktop screen sharing</span><select className="select" value={String(settings.requireDesktopScreen)} onChange={e => setBool('requireDesktopScreen', e.target.value === 'true')}><option value="true">Yes</option><option value="false">No</option></select></label>
            <label><span className="label">Reduced mobile/iPhone mode</span><select className="select" value={String(settings.reducedMobileMode)} onChange={e => setBool('reducedMobileMode', e.target.value === 'true')}><option value="true">Yes</option><option value="false">No</option></select></label>
            <div style={{ gridColumn: '1 / -1' }}><button className="btn btn-success" type="submit">Save Performance Settings</button></div>
          </form>
        </div>
      </div>
    </main>
  );
}
