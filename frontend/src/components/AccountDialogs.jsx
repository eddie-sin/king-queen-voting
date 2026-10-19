import { useEffect, useState } from 'react';
import { Dialog } from './Dialog.jsx';
import { Crown } from './Artwork.jsx';
import { myanmarTime, validKey } from '../domain.js';

export function AccountDialog({ initialMode = 'login', onClose, onLogin, onRegister, registrationStatus, schedule, onRefreshSchedule }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState(''); const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false); const [registrationUnknown, setRegistrationUnknown] = useState(false);
  const [registrationBlocked, setRegistrationBlocked] = useState(false);
  const register = mode === 'register';
  const switchMode = next => { setMode(next); setError(''); setPassword(''); };
  async function submit(e) {
    e.preventDefault(); if (busy) return;
    if (register && (registrationStatus !== 'open' || registrationBlocked)) return;
    setBusy(true); setError('');
    try {
      if (register) {
        const result = await onRegister(email.trim(), password);
        setNewKey(result.votingKey); setPassword('');
      } else { await onLogin(email.trim(), password); setPassword(''); onClose('authenticated'); }
    } catch (e) {
      setError(e.message);
      // A registration may have committed before a connection loss; never automatically replay it.
      if (register && (e.interrupted || e.message.includes('without a usable key'))) { setRegistrationUnknown(true); setRegistrationBlocked(true); }
    } finally { setBusy(false); }
  }
  if (newKey) return <Dialog title="Keep your little key safe." className="account-dialog key-display" locked onClose={() => {}}>
    <div className="dialog-ornament"><Crown/></div><p>Your account has been created. This voting key is shown <strong>once</strong> and cannot be recovered. You are not logged in yet.</p>
    <label htmlFor="issued-key">Your private voting key</label><textarea id="issued-key" className="issued-key" readOnly value={newKey} spellCheck="false" aria-describedby="key-warning"/>
    <button className="btn secondary" onClick={async () => { try { await navigator.clipboard.writeText(newKey); setCopied(true); } catch { setCopied(false); setError('Copy is unavailable. Select the key above and save it manually.'); } }}>{copied ? 'Copied — save it somewhere safe' : 'Copy voting key'}</button>
    <p id="key-warning" className="security-note">Save it in a password manager or another private place. Refreshing this page will lose this display. Never share your key.</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <label className="checkbox-label"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/>I have saved my voting key and understand it cannot be recovered.</label>
    <button className="btn primary full-width" disabled={!acknowledged} onClick={() => { setNewKey(''); setAcknowledged(false); setCopied(false); switchMode('login'); }}>Continue to login</button>
  </Dialog>;
  return <Dialog title={register ? 'Join the celebration.' : 'Welcome back.'} onClose={onClose} locked={busy} className="account-dialog">
    <div className="dialog-ornament"><Crown/></div><p className="dialog-intro">{register ? 'One account. Two choices. A moment to remember.' : 'Sign in, then unlock your choices with your voting key.'}</p>
    <div className="auth-tabs"><button aria-pressed={!register} onClick={() => switchMode('login')} disabled={busy}>Login</button><button aria-pressed={register} onClick={() => switchMode('register')} disabled={busy}>Register</button></div>
    {register && <p className="schedule-note">{registrationStatus === 'closed' ? 'Registration is closed.' : registrationStatus === 'unknown' ? 'Registration availability is not confirmed.' : `Registration closes ${myanmarTime(schedule?.registrationClosesAt)}.`}</p>}
    {register && registrationStatus === 'unknown' && <button className="btn secondary" onClick={onRefreshSchedule}>Refresh schedule</button>}
    <form onSubmit={submit}>
      <label htmlFor="account-email">Email address</label><input id="account-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={busy}/>
      <label htmlFor="account-password">Password</label><input id="account-password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} aria-describedby={register ? 'password-help' : undefined}/>
      {register && <p id="password-help" className="fine-print">Use at least 8 characters.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {registrationUnknown && <p className="inline-error">Registration may have completed. Please contact the organisers before trying to register again; this site cannot recover an issued key.</p>}
      <button className="btn primary full-width" disabled={busy || (register && (registrationStatus !== 'open' || registrationBlocked))}>{busy ? 'Please wait…' : register ? 'Create account' : 'Login'}</button>
    </form>
    {register && <details className="privacy-notice"><summary>We care about your security</summary><p>Your voting key and login token stay in memory on this page. Refreshing or signing out clears them. Keep your one-time key safe. Contact the event organisers for their account-data retention policy.</p></details>}
    <p className="fine-print">Your login and voting key are cleared when you refresh or sign out.</p>
  </Dialog>;
}

export function UnlockDialog({ onClose, onUnlock, busy, sessionPresent }) {
  const [key, setKey] = useState(''); const [error, setError] = useState('');
  useEffect(() => { if (!sessionPresent) setKey(''); }, [sessionPresent]);
  return <Dialog title="Unlock your choices." onClose={onClose} locked={busy} className="account-dialog">
    <div className="dialog-ornament"><Crown/></div><p>Use the private voting key you saved when you registered. Your King and Queen choices are independent.</p>
    <form onSubmit={async e => { e.preventDefault(); if (!validKey(key.trim())) { setError('Enter the complete 64-character lowercase hexadecimal key.'); return; } setError(''); try { await onUnlock(key.trim()); setKey(''); onClose('unlocked'); } catch (error) { setError(error.message); } }}>
      <label htmlFor="voting-key">Voting key</label><input id="voting-key" type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck="false" required disabled={busy || !sessionPresent} aria-describedby="key-help"/>
      <p id="key-help" className="fine-print">64 lowercase hexadecimal characters. Your key is never added to the page address or browser storage.</p>
      {error && <p role="alert" className="inline-error">{error}</p>}
      {!sessionPresent && <p role="alert">Your session has ended. Close this dialog and log in again.</p>}
      <button className="btn primary full-width" disabled={busy || !sessionPresent}>{busy ? 'Verifying…' : 'Unlock my choices'}</button>
    </form>
  </Dialog>;
}
