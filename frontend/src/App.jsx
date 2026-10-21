import { useEffect, useState } from 'react';
import { useFestival } from './hooks/useFestival.js';
import { titleCase } from './domain.js';
import { Brand, Crown, UserIcon, Sky, CategorySelection, CandidateCard, CandidateProfile, AccountDialog, UnlockDialog, ScheduleBanner, AccountPanel, ChoicesPage, VoteConfirmation, Celebration } from './components.jsx';
import { LanternGallery } from './components/LanternGallery.jsx';

const NAV_ITEMS = [
  { id: 'home', href: '#home', label: 'Home', hint: 'About the festival, dates & venue', match: ['home'] },
  { id: 'candidates', href: '#candidates', label: 'King & Queen', hint: 'Meet candidates & cast your crown', featured: true, match: ['candidates', 'king', 'queen'] },
  { id: 'finalists', href: '#finalists', label: 'Finalists', hint: 'Top 5 Kings & Top 5 Queens', match: ['finalists'] },
  { id: 'lanterns', href: '#lanterns', label: 'Lanterns', hint: 'Community lantern gallery', match: ['lanterns'] },
  { id: 'wish-sky', href: '#wish-sky', label: 'Wish Sky', hint: 'Write & share your wishes', match: ['wish-sky'] },
  { id: 'entertainment', href: '#entertainment', label: 'Entertainment', hint: 'Event day agenda & stage lineup', match: ['entertainment'] },
];

function readRoute() {
  const raw = location.hash.slice(1).toLowerCase();
  if (!raw || raw === 'home') return 'home';
  if (raw === 'choices' || raw === 'account') return 'account';
  if (raw === 'results' || raw === 'finalists') return 'finalists';
  if (['candidates', 'king', 'queen', 'lanterns', 'wish-sky', 'entertainment'].includes(raw)) return raw;
  return 'home';
}

function PlaceholderStage({ badge, title, description, primaryAction }) {
  return (
    <section className="source-section placeholder-section">
      <div className="placeholder-card">
        <div className="placeholder-ornament" aria-hidden="true"><Crown /></div>
        <span className="placeholder-badge">{badge}</span>
        <h2>{title}</h2>
        <p>{description}</p>
        {primaryAction && (
          <div className="placeholder-actions">
            <a className="btn primary" href={primaryAction.href}>{primaryAction.label}</a>
          </div>
        )}
      </div>
    </section>
  );
}

export default function App({ api, fixtureMode = false }) {
  const model = useFestival(api);
  const [route, setRoute] = useState(readRoute);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [accountMode, setAccountMode] = useState(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [intent, setIntent] = useState(null);
  const [pending, setPending] = useState(null);
  const viewable = model.status.voting === 'open' && model.choiceState === 'ready';
  const allDisabled = model.busy || model.status.voting !== 'open';
  const category = route === 'queen' ? 'queen' : 'king';
  const gallery = model.candidates.filter(c => c.category === category);
  const go = next => { location.hash = next; };

  useEffect(() => {
    const changed = () => {
      setRoute(readRoute());
      setMenuOpen(false);
      setProfile(null);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = e => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  // Preserve the source's return-to-candidate workflow across login and key entry.
  // Always stop at an explicit confirmation; authentication never casts a vote.
  useEffect(() => {
    if (!intent || accountMode || unlockOpen || model.busy) return;
    if (model.status.voting !== 'open') { setProfile(intent); setIntent(null); return; }
    if (!model.session) return;
    if (model.choiceState === 'uncertain') { setUnlockOpen(true); return; }
    if (!viewable) { setUnlockOpen(true); return; }
    const current = model.candidates.find(c => c._id === intent._id);
    setIntent(null);
    if (!current) return;
    if (model.choices[current.category]?._id === current._id) { setProfile(current); return; }
    setPending({ candidate: current, contest: current.category, action: model.choices[current.category] ? 'change' : 'submit' });
  }, [intent, accountMode, unlockOpen, model.busy, model.session, model.choiceState, model.status.voting, model.choices, model.candidates, viewable]);

  const requestVote = candidate => {
    if (allDisabled) return;
    setProfile(null);
    if (!model.session) { setIntent(candidate); setAccountMode('login'); return; }
    if (model.choiceState === 'uncertain') { setIntent(candidate); setUnlockOpen(true); return; }
    if (!viewable) { setIntent(candidate); setUnlockOpen(true); return; }
    setPending({ candidate, contest: candidate.category, action: model.choices[candidate.category] ? 'change' : 'submit' });
  };

  const label = allDisabled ? model.status.voting === 'closed' ? 'Voting closed' : 'Voting not available' : !model.session ? 'Sign in to vote' : model.choiceState === 'uncertain' ? 'Unlock to continue' : !viewable ? 'Unlock to vote' : model.choices[profile?.category] ? 'Move your crown here' : 'Cast your crown';
  const heading = (eye, title, description) => <div className="source-heading"><div className="eyebrow">{eye}</div><h1>{title}</h1><p>{description}</p></div>;

  return <div className="festival-app source-app">
    <a className="skip-link" href="#main">Skip to content</a><Sky/>
    <header className={`site-header ${menuOpen ? 'menu-is-open' : ''}`}>
      <div className="site-header-inner">
        <a className="brand-link" href="#home" aria-label="Thadingyut Festival of Lights" onClick={() => setMenuOpen(false)}><Brand/></a>

        <nav className="site-nav" aria-label="Main navigation">
          {NAV_ITEMS.map(item => {
            const active = item.match.includes(route);
            return (
              <a
                key={item.id}
                href={item.href}
                className={`nav-tab ${item.featured ? 'is-featured' : ''} ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {item.featured && <span className="nav-crown" aria-hidden="true">♔</span>}
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="header-actions">
          {model.session ? (
            <a
              href="#account"
              className={`account-button is-logged-in ${route === 'account' ? 'is-active' : ''}`}
              aria-current={route === 'account' ? 'page' : undefined}
              aria-label="Account and my choices"
              title={model.session.user?.email || 'Account'}
              onClick={() => setMenuOpen(false)}
            >
              <span className="account-icon-wrap" aria-hidden="true"><UserIcon /></span>
              <span className="account-label">Account</span>
            </a>
          ) : (
            <button
              type="button"
              className="account-button"
              onClick={() => { setMenuOpen(false); setAccountMode('login'); }}
              aria-label="Sign in"
            >
              <span className="account-icon-wrap" aria-hidden="true"><UserIcon /></span>
              <span className="account-label">Sign in</span>
            </button>
          )}

          <button
            type="button"
            className={`menu-toggle-btn ${menuOpen ? 'is-open' : ''}`}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-drawer"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setMenuOpen(v => !v)}
          >
            <span className="menu-toggle-bars" aria-hidden="true">
              <i /><i /><i />
            </span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <>
          <div className="mobile-nav-backdrop" aria-hidden="true" onClick={() => setMenuOpen(false)} />
          <div id="mobile-nav-drawer" className="mobile-nav-drawer" role="dialog" aria-label="Site navigation">
            <div className="mobile-nav-grid">
              {NAV_ITEMS.map(item => {
                const active = item.match.includes(route);
                return (
                  <a
                    key={item.id}
                    href={item.href}
                    className={`mobile-nav-card ${item.featured ? 'is-featured' : ''} ${active ? 'is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <div className="mobile-nav-title">
                      {item.featured && <span className="nav-crown" aria-hidden="true">♔</span>}
                      <span>{item.label}</span>
                    </div>
                    <small>{item.hint}</small>
                  </a>
                );
              })}
            </div>
            <div className="mobile-nav-footer">
              {model.session ? (
                <div className="mobile-account-bar">
                  <div className="mobile-account-user">
                    <span className="account-icon-wrap" aria-hidden="true"><UserIcon /></span>
                    <div>
                      <span className="eyebrow">SIGNED IN AS</span>
                      <strong>{model.session.user?.email}</strong>
                    </div>
                  </div>
                  <div className="mobile-account-actions">
                    <a className="btn primary" href="#account" onClick={() => setMenuOpen(false)}>Account &amp; Choices</a>
                    <button type="button" className="btn secondary" onClick={() => { setMenuOpen(false); model.signOut(); }}>Sign out</button>
                  </div>
                </div>
              ) : (
                <div className="mobile-account-bar">
                  <p>Sign in to view your account details and manage your King &amp; Queen choices.</p>
                  <div className="mobile-account-actions">
                    <button type="button" className="btn primary" onClick={() => { setMenuOpen(false); setAccountMode('login'); }}>Sign in</button>
                    <button type="button" className="btn secondary" onClick={() => { setMenuOpen(false); setAccountMode('register'); }}>Create account</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </header>

    {fixtureMode&&<div className="fixture-ribbon">LOCAL FIXTURE PREVIEW · Sample identities · No real votes are sent</div>}
    <main id="main" tabIndex="-1"><div className="source-page" key={route}>
      {route==='home' ? <>
        {heading('THADINGYUT FESTIVAL OF LIGHTS',<>A night of light,<br/>tradition &amp; <em>celebration.</em></>,'Welcome to the official Thadingyut Festival experience — discover the event story, dates, times, venue locations, and community celebrations.')}
        <PlaceholderStage
          badge="HOME · ABOUT THE EVENT"
          title={<>Festival overview &amp; <em>event details</em></>}
          description="This page will feature the full festival story, event dates, schedule times, venue map, and celebration highlights. Meanwhile, explore our King & Queen candidates and cast your crown."
          primaryAction={{ href: '#candidates', label: 'Explore King & Queen Voting' }}
        />
      </> : route==='candidates' ? <>
        {heading('YOUR VOICE. THEIR MOMENT.',<>Every crown begins<br/>with <em>your choice.</em></>,'Choose a category, discover the candidates, and vote for the person who captures the spirit of our festival.')}
        <section className="source-section selection-section"><CategorySelection onSelect={go}/><p className="source-note">How it works: explore a category → open a candidate → sign in → unlock with your voting key → confirm your crown. <a href="#account">Review, change, or remove your choices</a> in your account while voting is open.</p></section>
      </> : route==='king'||route==='queen' ? <>
        {heading('THE FACES OF THE FESTIVAL',<>Meet the <em>{category==='king'?'Kings':'Queens'}.</em></>,'Get to know each candidate before choosing who deserves your crown.')}
        <section className="source-section gallery-section"><div className="source-tabs" aria-label="Candidate category">{['king','queen'].map(c=><a href={`#${c}`} key={c} aria-current={category===c?'page':undefined}>{c==='king'?'♔':'♕'} &nbsp; {titleCase(c)}s</a>)}</div>
        <ScheduleBanner status={model.status.voting} schedule={model.schedule} error={model.scheduleError} onRetry={model.reloadSchedule}/>
        {model.candidateState==='loading'?<div className="empty-state" role="status">Preparing the spotlight…</div>:model.candidateState==='error'?<div className="empty-state" role="alert"><h3>The spotlight needs a moment.</h3><p>{model.candidateError}</p><button className="btn secondary" onClick={model.reloadCandidates}>Retry candidates</button></div>:!gallery.length?<div className="empty-state"><h3>A little anticipation.</h3><p>No active {category} candidates have been announced yet.</p></div>:<div className="gallery">{gallery.map((c,i)=><CandidateCard key={c._id} candidate={c} number={i+1} selected={viewable&&model.choices[category]?._id===c._id} onView={setProfile}/>)}</div>}
        <p className="source-note">One to three photos per candidate. Swipe sideways or tap a dot to explore; autoplay pauses when you interact. Your King and Queen choices are saved separately.</p><div className="source-page-links"><a className="text-button" href="#candidates">Back to categories</a><a className="text-button" href="#account">Review my choices</a></div></section>
      </> : route==='finalists' ? <>
        {heading('ROYAL COURT ANNOUNCEMENT',<>Top 5 <em>Kings &amp; Queens.</em></>,'Honouring the top 5 King finalists and top 5 Queen finalists chosen by the festival community.')}
        <PlaceholderStage
          badge="FINALISTS · TOP 5 KINGS & TOP 5 QUEENS"
          title={<>The Royal Finalists <em>Showcase</em></>}
          description="Once the results announcement window opens, the top 5 Kings and top 5 Queens from community voting will be unveiled and celebrated right here."
          primaryAction={{ href: '#candidates', label: 'Meet the Candidates' }}
        />
      </> : route==='lanterns' ? <>
        {heading('LIGHTS OF THADINGYUT',<>Lanterns and their <em>stories.</em></>,'Discover the craft, meaning, and warm glow behind the festival lanterns shared by our community.')}
        <section className="source-section lantern-section"><LanternGallery lanterns={model.lanterns} state={model.lanternState} error={model.lanternError} onRetry={model.reloadLanterns}/></section>
      </> : route==='wish-sky' ? <>
        {heading('A SKY FULL OF LIGHT',<>The <em>Wish Sky.</em></>,'Write your heartfelt Thadingyut wishes and watch them rise among the glowing lanterns in our night sky.')}
        <PlaceholderStage
          badge="WISH SKY · COMMUNITY WISHES"
          title={<>Send your wish into the <em>night sky</em></>}
          description="Soon you will be able to write your personal festival wishes and release glowing lanterns across the shared Thadingyut sky."
          primaryAction={{ href: '#lanterns', label: 'Explore Lantern Gallery' }}
        />
      </> : route==='entertainment' ? <>
        {heading('FESTIVAL STAGE & LINEUP',<>Event day <em>entertainment.</em></>,'Explore the full agenda of live performances, cultural showcases, music, and activities on festival day.')}
        <PlaceholderStage
          badge="ENTERTAINMENT · EVENT AGENDA"
          title={<>Stage schedule &amp; <em>performances</em></>}
          description="The complete event-day timetable, performance lineup, and celebration activities will be published here."
          primaryAction={{ href: '#home', label: 'Back to Festival Home' }}
        />
      </> : route==='account' ? <>
        {heading('YOUR FESTIVAL ACCOUNT',<>Account &amp; <em>my choices.</em></>,'View your account details, check your voting participation, and unlock, change, or remove your King and Queen choices.')}
        <AccountPanel
          session={model.session}
          status={model.status.voting}
          choices={model.choices}
          choiceState={model.choiceState}
          busy={model.busy}
          onLogin={() => setAccountMode('login')}
          onRegister={() => setAccountMode('register')}
          onSignOut={model.signOut}
          onUnlock={() => setUnlockOpen(true)}
          onLockChoices={model.lockChoices}
        />
        <ChoicesPage
          status={model.status.voting}
          session={model.session}
          choices={model.choices}
          choiceState={model.choiceState}
          busy={model.busy}
          onLogin={() => setAccountMode('login')}
          onUnlock={() => setUnlockOpen(true)}
          onRefresh={model.refreshChoices}
          onChange={contest => go(contest)}
          onRemove={contest => setPending({ candidate: model.choices[contest], contest, action: 'remove' })}
          onBrowse={go}
          onRetrySchedule={model.reloadSchedule}
        />
      </> : null}
      {model.notice&&<div className={`notice ${model.notice.type}`} role={model.notice.type==='error'?'alert':'status'}><p>{model.notice.text}</p><button aria-label="Dismiss message" onClick={model.dismissNotice}>×</button></div>}
    </div></main>
    <footer className="site-footer"><a href="#home"><Brand/></a><p>Wishing you all a fun moment.<br/><span>Thadingyut · Festival of Lights celebration</span></p></footer>
    {profile&&<CandidateProfile candidate={profile} selected={viewable&&model.choices[profile.category]?._id===profile._id} canVote={!allDisabled} votingStatus={model.status.voting} actionLabel={label} onVote={requestVote} onClose={()=>setProfile(null)}/>}
    {accountMode&&<AccountDialog initialMode={accountMode} onClose={reason=>{setAccountMode(null);if(reason!=='authenticated'){setProfile(intent);setIntent(null);}}} onLogin={async(...args)=>{await model.login(...args);}} onRegister={model.register} registrationStatus={model.status.registration} schedule={model.schedule} onRefreshSchedule={model.reloadSchedule}/>}
    {unlockOpen&&<UnlockDialog onClose={reason=>{setUnlockOpen(false);if(reason!=='unlocked'){setProfile(intent);setIntent(null);}}} onUnlock={async key=>{await model.unlock(key);}} busy={model.busy} sessionPresent={Boolean(model.session)}/>}
    {pending&&<VoteConfirmation pending={pending} previous={model.choices[pending.contest]} busy={model.busy} canConfirm={viewable&&Boolean(model.session)} onClose={()=>{if(pending.action!=='remove')setProfile(pending.candidate);setPending(null);}} onConfirm={async()=>{const candidate=pending.candidate;const success=await model.mutate(pending);setPending(null);if(success)go('account');else if(pending.action!=='remove')setProfile(candidate);}}/>}
    <Celebration event={model.celebration}/>
  </div>;
}
