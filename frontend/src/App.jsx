import { useEffect, useRef, useState } from 'react';
import { LanternResultsPage, SectionResultsLink } from './components/SectionResults.jsx';
import { announceAccountChange } from './authSession.js';
import { SiteHeader } from './components/SiteHeader.jsx';
import WishSky from './wishes/WishSky.jsx';
import { readStoredSession, writeStoredSession, useFestival } from './hooks/useFestival.js';
import { titleCase } from './domain.js';
import {
  Brand,
  Crown,
  Sky,
  CategorySelection,
  CandidateCard,
  CandidateProfile,
  AccountDialog,
  StatusBanner,
  AccountPanel,
  ChoicesPage,
  VoteConfirmation,
  Celebration,
} from './components.jsx';
import { LanternGallery } from './components/LanternGallery.jsx';
import MusicPlayer from './components/MusicPlayer.jsx';
import PrivacyPage from './components/PrivacyPage.jsx';
import HomePage from './components/HomePage.jsx';
import DevelopersPage from './components/DevelopersPage.jsx';
import './home.css';
import { ResultsPage } from './components/Results.jsx';
import MemoryPhotoDemo from './memory/MemoryPhotoDemo.jsx';
import { memoryTabFromHash } from './memory/demo.js';

const NAV_ITEMS = [
  {
    id: 'home',
    href: '#home',
    label: 'Home',
    hint: 'About the festival, dates & venue',
    match: ['home'],
  },
  {
    id: 'candidates',
    href: '#candidates',
    label: 'King & Queen',
    hint: 'Meet candidates & cast your crown',
    featured: true,
    match: ['candidates', 'king', 'queen', 'results'],
  },
  {
    id: 'lanterns',
    href: '#lanterns',
    label: 'Lanterns',
    hint: 'Community lantern gallery',
    match: ['lanterns', 'lantern-results'],
  },
  {
    id: 'wish-sky',
    href: '#wishes',
    label: 'Wish Sky',
    hint: 'Write & share your wishes',
    match: ['wishes'],
  },
  {
    id: 'memory-gallery',
    href: '#memory-gallery',
    label: 'Memory Photo',
    hint: 'Browse festival memories & share your photos',
    match: ['memory-gallery', 'my-memories', 'memory-upload'],
  },
  {
    id: 'entertainment',
    href: '#entertainment',
    label: 'Entertainment',
    hint: 'Event day agenda & stage lineup',
    match: ['entertainment'],
  },
];

function readRoute() {
  if (location.pathname === '/privacy' && !location.hash) return 'privacy';
  const raw = location.hash.slice(1).toLowerCase();
  if (!raw || raw === 'home') return 'home';
  if (raw === 'choices' || raw === 'account') return 'account';
  if (raw === 'results' || raw === 'finalists') return 'results';
  if (raw === 'lantern-results') return 'lantern-results';
  if (raw === 'wish-sky') return 'wishes';
  if (
    [
      'candidates',
      'king',
      'queen',
      'lanterns',
      'wishes',
      'entertainment',
      'developers',
      'privacy',
    ].includes(raw)
  ) {
    return raw;
  }
  return 'home';
}

function PlaceholderStage({ badge, title, description, primaryAction }) {
  return (
    <section className="source-section placeholder-section">
      <div className="placeholder-card">
        <div className="placeholder-ornament" aria-hidden="true">
          <Crown />
        </div>
        <span className="placeholder-badge">{badge}</span>
        <h2>{title}</h2>
        <p>{description}</p>
        {primaryAction && (
          <div className="placeholder-actions">
            <a className="btn primary" href={primaryAction.href}>
              {primaryAction.label}
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

export default function App(props) {
  const [memoryMenuOpen, setMemoryMenuOpen] = useState(false);
  const [memorySession, setMemorySession] = useState(readStoredSession);
  const [memoryAuthError, setMemoryAuthError] = useState('');
  const memoryAuthSequence = useRef(0);
  const [returnToMemories, setReturnToMemories] = useState(false);
  const [memoryHash, setMemoryHash] = useState(() => location.hash);
  const memoryTab = memoryTabFromHash(memoryHash);

  useEffect(() => {
    const changed = () => {
      setMemoryHash(location.hash);
      setMemoryMenuOpen(false);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  useEffect(() => {
    if (!returnToMemories) return;
    if (location.hash !== '#account') {
      setReturnToMemories(false);
      return;
    }
    const resume = () => {
      if (location.hash === '#account' && readStoredSession()) {
        setReturnToMemories(false);
        location.hash = '#memory-gallery';
      }
    };
    resume();
    const timer = setInterval(resume, 250);
    return () => clearInterval(timer);
  }, [returnToMemories, memoryHash]);

  useEffect(() => {
    if (!memoryTab) return;
    const sync = () => {
      const next = readStoredSession();
      setMemorySession(previous =>
        previous?.token === next?.token && previous?.user?.email === next?.user?.email
          ? previous
          : next,
      );
    };
    sync();
    const timer = setInterval(sync, 500);
    window.addEventListener('festival-session-change', sync);
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener('festival-session-change', sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
    };
  }, [Boolean(memoryTab)]);

  const isDemo =
    props.fixtureMode ||
    ['#my-memories-demo', '#memory-gallery-demo', '#memory-upload-demo'].includes(
      memoryHash,
    );

  useEffect(() => {
    if (!memoryTab || isDemo || !props.api?.session) return;
    let live = true;
    const restore = async () => {
      const sequence = ++memoryAuthSequence.current;
      try {
        const data = await props.api.session();
        if (live && sequence === memoryAuthSequence.current) {
          writeStoredSession({ token: data.sessionKey, user: data.user });
        }
      } catch (e) {
        if (
          live &&
          sequence === memoryAuthSequence.current &&
          [401, 403].includes(e.status)
        ) {
          writeStoredSession(null);
        }
      }
    };
    const external = e => {
      if (e.key === 'festival-account-change') restore();
    };
    restore();
    window.addEventListener('focus', restore);
    window.addEventListener('storage', external);
    return () => {
      live = false;
      window.removeEventListener('focus', restore);
      window.removeEventListener('storage', external);
    };
  }, [Boolean(memoryTab), props.api]);

  const memorySignOut = async () => {
    try {
      await props.api.logout?.();
      memoryAuthSequence.current++;
      writeStoredSession(null);
      announceAccountChange();
      window.google?.accounts?.id?.disableAutoSelect();
      setMemoryAuthError('');
    } catch {
      setMemoryAuthError(
        'Sign-out could not be confirmed. Check your connection and retry.',
      );
    }
  };

  const memoryLogin = () => {
    setMemoryMenuOpen(false);
    setReturnToMemories(true);
    location.hash = '#account';
  };

  // Memory pages reuse the session store without mounting unrelated API hooks.
  if (memoryTab) {
    return (
      <div className="festival-app source-app memory-route">
        <SiteHeader
          items={NAV_ITEMS}
          route="memory-gallery"
          session={memorySession}
          menuOpen={memoryMenuOpen}
          setMenuOpen={setMemoryMenuOpen}
          onLogin={memoryLogin}
          onRegister={memoryLogin}
          onSignOut={memorySignOut}
        />
        {memoryAuthError && <p role="alert">{memoryAuthError}</p>}
        <MemoryPhotoDemo
          tab={memoryTab}
          api={props.api}
          onRequireLogin={memoryLogin}
          demo={
            props.fixtureMode ||
            ['#my-memories-demo', '#memory-gallery-demo', '#memory-upload-demo'].includes(
              memoryHash,
            )
          }
        />
      </div>
    );
  }

  return <FestivalApp {...props} />;
}

function FestivalApp({ api, wishApi, fixtureMode = false }) {
  const model = useFestival(api);
  const [route, setRoute] = useState(readRoute);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [accountMode, setAccountMode] = useState(null);
  const [intent, setIntent] = useState(null);
  const [pending, setPending] = useState(null);

  const viewable = model.choiceState === 'ready';
  const allDisabled = model.busy || model.status.voting !== 'open';
  const category = route === 'queen' ? 'queen' : 'king';
  const gallery = model.candidates.filter(c => c.category === category);
  const go = next => {
    location.hash = next;
  };

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

  // Authentication only resumes the confirmation flow; it never casts a vote.
  useEffect(() => {
    if (!intent || accountMode || model.busy || !model.session || !viewable) return;
    const current = model.candidates.find(candidate => candidate._id === intent._id);
    setIntent(null);
    if (!current || model.status.voting !== 'open' || model.choices[current.category]) {
      if (current) setProfile(current);
      return;
    }
    setPending({ candidate: current, contest: current.category });
  }, [
    intent,
    accountMode,
    model.busy,
    model.session,
    viewable,
    model.status.voting,
    model.choices,
    model.candidates,
  ]);

  const requestVote = candidate => {
    if (allDisabled) return;
    if (!model.session) {
      setProfile(null);
      setIntent(candidate);
      setAccountMode('login');
      return;
    }
    if (!viewable) {
      model.refreshChoices();
      return;
    }
    if (model.choices[candidate.category]) return;
    setProfile(null);
    setPending({ candidate, contest: candidate.category });
  };

  const label = allDisabled
    ? 'Voting closed'
    : !model.session
      ? 'Sign in to vote'
      : !viewable
        ? 'Refresh choices to vote'
        : model.choices[profile?.category]
          ? 'You have already voted in this category'
          : 'Cast your crown';

  const heading = (eye, title, description) => (
    <div className="source-heading">
      <div className="eyebrow">{eye}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );

  return (
    <div
      className={`festival-app source-app ${route === 'home' ? 'home-route' : ''} ${route === 'wishes' ? 'wish-route' : ''}`}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sky />
      <SiteHeader
        items={NAV_ITEMS}
        route={route}
        session={model.session}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        onLogin={() => setAccountMode('login')}
        onRegister={() => setAccountMode('register')}
        onSignOut={model.signOut}
      />

      {fixtureMode && (
        <div className="fixture-ribbon">
          LOCAL FIXTURE PREVIEW · Sample identities · No real votes are sent
        </div>
      )}

      <main id="main" tabIndex="-1">
        <div className="source-page" key={route}>
          {route === 'privacy' && <PrivacyPage />}
          {route === 'home' ? (
            <HomePage />
          ) : route === 'developers' ? (
            <DevelopersPage />
          ) : route === 'candidates' ? (
            <>
              <SectionResultsLink href="#results" />
              {heading(
                'YOUR VOICE. THEIR MOMENT.',
                <>
                  Every crown begins
                  <br />
                  with <em>your choice.</em>
                </>,
                'Choose a category, discover the candidates, and vote for the person who captures the spirit of our festival.',
              )}
              <section className="source-section selection-section">
                <CategorySelection onSelect={go} />
                <p className="source-note">
                  How it works: explore a category → open a candidate → sign in → confirm
                  your final choice. One vote for King and one for Queen.{' '}
                  <a href="#account">View your recorded choices</a> in your account.
                </p>
              </section>
            </>
          ) : route === 'king' || route === 'queen' ? (
            <>
              <SectionResultsLink href="#results" />
              {heading(
                'THE FACES OF THE FESTIVAL',
                <>
                  Meet the <em>{category === 'king' ? 'Kings' : 'Queens'}.</em>
                </>,
                'Get to know each candidate before choosing who deserves your crown.',
              )}
              <section className="source-section gallery-section">
                <div className="source-tabs" aria-label="Candidate category">
                  {['king', 'queen'].map(c => (
                    <a
                      href={`#${c}`}
                      key={c}
                      aria-current={category === c ? 'page' : undefined}
                    >
                      {c === 'king' ? '♔' : '♕'} &nbsp; {titleCase(c)}s
                    </a>
                  ))}
                </div>
                <StatusBanner
                  status={model.status.voting}
                  error={model.controlsError}
                  onRetry={model.reloadControls}
                />
                {model.candidateState === 'loading' ? (
                  <div className="empty-state" role="status">
                    Preparing the spotlight…
                  </div>
                ) : model.candidateState === 'error' ? (
                  <div className="empty-state" role="alert">
                    <h3>The spotlight needs a moment.</h3>
                    <p>{model.candidateError}</p>
                    <button className="btn secondary" onClick={model.reloadCandidates}>
                      Retry candidates
                    </button>
                  </div>
                ) : !gallery.length ? (
                  <div className="empty-state">
                    <h3>A little anticipation.</h3>
                    <p>No active {category} candidates have been announced yet.</p>
                  </div>
                ) : (
                  <div className="gallery">
                    {gallery.map((c, i) => (
                      <CandidateCard
                        key={c._id}
                        candidate={c}
                        number={i + 1}
                        selected={viewable && model.choices[category]?._id === c._id}
                        onView={setProfile}
                      />
                    ))}
                  </div>
                )}
                <p className="source-note">
                  One to three photos per candidate. Swipe sideways or tap a dot to
                  explore; autoplay pauses when you interact. Your King and Queen choices
                  are saved separately.
                </p>
                <div className="source-page-links">
                  <a className="text-button" href="#candidates">
                    Back to categories
                  </a>
                  <a className="text-button" href="#account">
                    Review my choices
                  </a>
                </div>
              </section>
            </>
          ) : route === 'results' ? (
            <ResultsPage
              stage={model.resultsStage}
              results={model.results}
              load={model.resultsLoad}
              error={model.resultsError}
              onRetry={model.reloadResults}
              onRefreshControls={model.reloadControls}
            />
          ) : route === 'lanterns' ? (
            <>
              <SectionResultsLink href="#lantern-results" />
              {heading(
                'LIGHTS OF THADINGYUT',
                <>
                  Lanterns and their <em>stories.</em>
                </>,
                'Discover the craft, meaning, and warm glow behind the festival lanterns shared by our community.',
              )}
              <section className="source-section lantern-section">
                <LanternGallery
                  api={api}
                  session={model.session}
                  onRequireLogin={() => setAccountMode('login')}
                  lanterns={model.lanterns}
                  state={model.lanternState}
                  error={model.lanternError}
                  onRetry={model.reloadLanterns}
                />
              </section>
            </>
          ) : route === 'lantern-results' ? (
            <LanternResultsPage />
          ) : route === 'wishes' ? (
            <WishSky
              api={wishApi}
              session={model.session}
              onRequireLogin={() => setAccountMode('login')}
              accountOpen={Boolean(accountMode)}
              paused={false}
            />
          ) : route === 'entertainment' ? (
            <>
              {heading(
                'FESTIVAL STAGE & LINEUP',
                <>
                  Event day <em>entertainment.</em>
                </>,
                'Explore the full agenda of live performances, cultural showcases, music, and activities on festival day.',
              )}
              <PlaceholderStage
                badge="ENTERTAINMENT · EVENT AGENDA"
                title={
                  <>
                    Stage schedule &amp; <em>performances</em>
                  </>
                }
                description="The complete event-day timetable, performance lineup, and celebration activities will be published here."
                primaryAction={{ href: '#home', label: 'Back to Festival Home' }}
              />
            </>
          ) : route === 'account' ? (
            <>
              {heading(
                'YOUR FESTIVAL ACCOUNT',
                <>
                  Account &amp; <em>my choices.</em>
                </>,
                'View your account details and your recorded King and Queen votes. Each submitted vote is final.',
              )}
              <AccountPanel
                session={model.session}
                status={model.status.voting}
                choices={model.choices}
                choiceState={model.choiceState}
                busy={model.busy}
                onLogin={() => setAccountMode('login')}
                onRegister={() => setAccountMode('register')}
                onSignOut={model.signOut}
              />
              <ChoicesPage
                status={model.status.voting}
                session={model.session}
                choices={model.choices}
                choiceState={model.choiceState}
                busy={model.busy}
                onLogin={() => setAccountMode('login')}
                onRefresh={model.refreshChoices}
                onBrowse={go}
                onRetryControls={model.reloadControls}
              />
            </>
          ) : null}

          {model.notice && (
            <div
              className={`notice ${model.notice.type}`}
              role={model.notice.type === 'error' ? 'alert' : 'status'}
            >
              <p>{model.notice.text}</p>
              <button aria-label="Dismiss message" onClick={model.dismissNotice}>
                ×
              </button>
            </div>
          )}
        </div>
      </main>

      <footer className="site-footer">
        <a href="#home">
          <Brand />
        </a>
        <a href="#privacy">Privacy</a>
        <p>
          Wishing you all a fun moment.
          <br />
          <span>Thadingyut · Festival of Lights celebration</span>
        </p>
      </footer>

      {route === 'wishes' && <MusicPlayer />}

      {profile && (
        <CandidateProfile
          candidate={profile}
          selected={viewable && model.choices[profile.category]?._id === profile._id}
          canVote={
            !allDisabled &&
            (!model.session || (viewable && !model.choices[profile.category]))
          }
          votingStatus={model.status.voting}
          actionLabel={label}
          onVote={requestVote}
          onClose={() => setProfile(null)}
        />
      )}

      {accountMode && (
        <AccountDialog
          api={api}
          onAuthenticated={model.acceptLogin}
          initialMode={accountMode}
          onClose={reason => {
            setAccountMode(null);
            if (reason !== 'authenticated') {
              setProfile(intent);
              setIntent(null);
            }
          }}
          onLogin={async (...args) => {
            await model.login(...args);
          }}
          onRegister={model.register}
          registrationStatus={model.status.registration}
          onRefreshControls={model.reloadControls}
        />
      )}

      {pending && (
        <VoteConfirmation
          pending={pending}
          previous={model.choices[pending.contest]}
          busy={model.busy}
          canConfirm={
            viewable &&
            Boolean(model.session) &&
            model.status.voting === 'open' &&
            !model.choices[pending.contest]
          }
          onClose={() => {
            setProfile(pending.candidate);
            setPending(null);
          }}
          onConfirm={async () => {
            const candidate = pending.candidate;
            const success = await model.mutate(pending);
            setPending(null);
            if (success) go('account');
            else setProfile(candidate);
          }}
        />
      )}

      <Celebration event={model.celebration} />
    </div>
  );
}
