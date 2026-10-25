import { useState } from 'react';
import { Dialog } from './Dialog.jsx';
import { Crown } from './Artwork.jsx';
export function AccountDialog({ initialMode = 'login', onClose, onLogin, onRegister, registrationStatus, onRefreshControls }) {
  const [mode, setMode] = useState(initialMode), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [created, setCreated] = useState(false);
  const [showPassword,setShowPassword]=useState(false);
  const register = mode === 'register';
  const switchMode = next => { setMode(next); setError(''); setPassword(''); };
  async function submit(event) {
    event.preventDefault(); if (busy || register && registrationStatus !== 'open') return;
    setBusy(true); setError('');
    try {
      if (register) { await onRegister(email.trim(), password); setCreated(true); switchMode('login'); }
      else { await onLogin(email.trim(), password); setPassword(''); onClose('authenticated'); }
    } catch (failure) {
      setError(failure.interrupted && register ? 'The connection was interrupted. Your account may have been created. Try signing in with these details first.' : failure.message);
    } finally { setBusy(false); }
  }
  return <Dialog title={register ? 'Join the celebration.' : 'Welcome back.'} onClose={onClose} locked={busy} className="account-dialog">
    <div className="dialog-ornament"><Crown/></div>
    <p className="dialog-intro">One account. One King vote. One Queen vote.</p>
    <div className="auth-tabs"><button aria-pressed={!register} onClick={() => switchMode('login')} disabled={busy}>Sign in</button><button aria-pressed={register} onClick={() => switchMode('register')} disabled={busy}>Register</button></div>
    {created && <p role="status">Your account is ready. Sign in below.</p>}
    {register && <p className="schedule-note">{registrationStatus === 'open' ? 'Registration is open.' : registrationStatus === 'closed' ? 'Registration is closed by the organisers.' : 'Checking registration availability…'}</p>}
    {register && registrationStatus === 'unknown' && <button className="btn secondary" onClick={onRefreshControls}>Refresh status</button>}
    <form onSubmit={submit}>
      <label htmlFor="account-email">Email address</label><input id="account-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} required disabled={busy}/>
      <label htmlFor="account-password">Password</label><input id="account-password" type={showPassword?'text':'password'} autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} required disabled={busy}/>
      <label className="show-password"><input type="checkbox" checked={showPassword} onChange={e=>setShowPassword(e.target.checked)}/> Show password</label>
      {register && <p className="fine-print">Use at least 8 characters and at most 72 UTF-8 bytes.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="btn primary full-width" disabled={busy || register && registrationStatus !== 'open'}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
    </form>
    <p className="fine-print">Sign out when using a shared device. Submitted votes cannot be changed or removed.</p>
  </Dialog>;
}
