import { useEffect, useState } from 'react';
import { AccountDialog } from './AccountDialogs.jsx';

export default function AuthLanding({ api, registrationStatus, onOpenLogin, onOpenRegister, onLogin, onRegister, onAuthenticated, onRefreshControls }) {
  const [mode, setMode] = useState(null);
  useEffect(() => {
    const open = event => setMode(event.detail === 'register' ? 'register' : 'login');
    window.addEventListener('auth-landing-open', open);
    return () => window.removeEventListener('auth-landing-open', open);
  }, []);
  return (
    <>
      <main className="auth-landing" id="main">
        <div className="auth-landing-glow" aria-hidden="true">
          <span /><span /><span /><b className="auth-star star-one">✦</b><b className="auth-star star-two">✦</b><b className="auth-star star-three">✧</b>
          <i className="auth-moon" />
          <i className="auth-floating-lantern lantern-one" /><i className="auth-floating-lantern lantern-two" /><i className="auth-floating-lantern lantern-three" /><i className="auth-floating-lantern lantern-four" /><i className="auth-floating-lantern lantern-five" />
          <i className="auth-oil-lamp oil-one" /><i className="auth-oil-lamp oil-two" /><i className="auth-oil-lamp oil-three" /><i className="auth-oil-lamp oil-four" />
        </div>
        <section className="auth-landing-card" aria-labelledby="auth-landing-title">
          <div className="auth-landing-copy">
            <p className="eyebrow">GUSTO COLLEGE · DEVELOPED BY BELOVED GUSTO CODING CLUB</p>
            <h1 id="auth-landing-title">Thadingyut<br /><em>Homage Paying Ceremony</em></h1>
            <p className="auth-landing-lede auth-burmese">မိသားစုနှင့် ဆရာသမားများကို ရိုသေလေးစားစွာ ဂါရဝပြုရင်း သီတင်းကျွတ်အလင်းရောင်ကို အတူမျှဝေကြစို့။</p>
            <div className="auth-landing-signature"><span>06 · 11 · 2026</span><i /> <span>GUSTO COLLEGE</span></div>
          </div>
          <div className="auth-portal" aria-label="Account access">
            <div className="auth-lamp" aria-hidden="true"><i /><b /></div>
            <p className="auth-portal-kicker">STEP INTO THE LIGHT</p>
            <div className="auth-landing-tabs" role="tablist" aria-label="Account access">
              <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); onOpenLogin?.(); }}>Sign in <span>ဝင်ရောက်မယ်</span></button>
              <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); onOpenRegister?.(); }}>Sign up <span>အကောင့်ဖွင့်မယ်</span></button>
            </div>
            <p className="auth-landing-note"><a href="#privacy">Privacy and account information</a></p>
            <p className="auth-landing-note">Gmail/password, verification codes and Google sign-in are available through the secure account flow.</p>
          </div>
        </section>
      </main>
      {mode && <AccountDialog api={api} initialMode={mode} registrationStatus={registrationStatus} onRefreshControls={onRefreshControls} onAuthenticated={onAuthenticated} onLogin={onLogin} onRegister={onRegister} onClose={() => setMode(null)} />}
    </>
  );
}
