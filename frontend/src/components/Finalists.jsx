import { useState } from 'react';
import { myanmarTime } from '../domain.js';

const LANTERNS = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];

function countdownParts(target, now) {
  const ms = Math.max(0, Date.parse(target) - now);
  const s = Math.floor(ms / 1000);
  return [
    ['Days', Math.floor(s / 86400)],
    ['Hours', Math.floor((s % 86400) / 3600)],
    ['Minutes', Math.floor((s % 3600) / 60)],
    ['Seconds', s % 60],
  ];
}

function FinalistsHero() {
  return <header className="fin-hero">
    <div className="fin-eyebrow" aria-hidden="true">✦</div>
    <h1>The Top Five<em>The royal ten</em></h1>
    <div className="fin-ornament" aria-hidden="true">— ✦ —</div>
    <div className="fin-eyebrow">THADINGYUT FESTIVAL 2026</div>
  </header>;
}

function Waiting({ schedule, now, stage, load, error, onRetry, onRetrySchedule }) {
  const published = schedule?.resultsPublishedAt;
  const upcoming = stage === 'waiting' && published && Date.parse(published) > now;
  return <section className="fin-waiting" aria-live="polite">
    <span className="fin-waiting-crown" aria-hidden="true">♔ ♕</span>
    {stage === 'unknown' ? <>
      <h2>Checking the <em>announcement</em> time…</h2>
      <p>The event schedule could not be confirmed right now.</p>
      <button className="btn secondary" onClick={onRetrySchedule}>Refresh schedule</button>
    </> : load === 'error' ? <>
      <h2>The royal court needs <em>a moment.</em></h2>
      <p>{error}</p>
      <button className="btn secondary" onClick={onRetry}>Try again</button>
    </> : upcoming ? <>
      <span className="fin-label">THE ROYAL TEN WILL BE REVEALED ON</span>
      <h2>{myanmarTime(published)}</h2>
      <div className="fin-countdown" role="timer" aria-label="Time until the announcement">
        {countdownParts(published, now).map(([label, value]) => <div className="fin-count" key={label}>
          <strong>{String(value).padStart(2, '0')}</strong><span>{label}</span>
        </div>)}
      </div>
      <p>Five Kings and five Queens, chosen by the festival community. Until then, every candidate still shines.</p>
      <a className="btn secondary" href="#candidates">Meet the candidates</a>
    </> : <>
      <span className="fin-label">ALMOST TIME</span>
      <h2>The royal court is <em>being prepared.</em></h2>
      <p>The Top 5 Kings and Top 5 Queens will appear here very soon. Please check back shortly.</p>
    </>}
  </section>;
}

function FinalistCard({ person, contest }) {
  const photo = person.images?.[0];
  return <article className="fin-card">
    {photo ? <img className="fin-photo" src={photo} alt={person.fullName} loading="lazy"/> : <div className="fin-photo fin-photo-empty" aria-hidden="true">{contest === 'king' ? '♔' : '♕'}</div>}
    <span className="fin-crown" aria-hidden="true">{contest === 'king' ? '♔' : '♕'}</span>
    <h3>{person.fullName}</h3>
    {person.batchNumber && <p className="fin-batch">BATCH {person.batchNumber}</p>}
    <span className="fin-place">TOP 5 {contest === 'king' ? 'KING' : 'QUEEN'}</span>
  </article>;
}

function Announced({ finalists }) {
  const [contest, setContest] = useState('king');
  const list = finalists?.[contest] || [];
  return <section className="fin-announcement">
    <div className="fin-tabs-wrap">
      <span className="fin-side-line" aria-hidden="true"/>
      <div className="fin-tabs" role="group" aria-label="Choose category">
        {['king', 'queen'].map(c => <button key={c} type="button" className={`fin-tab ${contest === c ? 'active' : ''}`} aria-pressed={contest === c} onClick={() => setContest(c)}>
          <span className="fin-tab-icon" aria-hidden="true">{c === 'king' ? '♔' : '♛'}</span>
          <span>Top 5 {c === 'king' ? 'Kings' : 'Queens'}</span>
        </button>)}
      </div>
      <span className="fin-side-line" aria-hidden="true"/>
    </div>
    {list.length ? <div className="fin-grid" key={contest}>{list.map(p => <FinalistCard key={p._id} person={p} contest={contest}/>)}</div>
      : <div className="empty-state"><h3>No finalists to show.</h3><p>There were no active {contest} finalists in this election.</p></div>}
    <p className="fin-note">Shown in alphabetical order. Every finalist stands equally among the royal ten.</p>
  </section>;
}

export function FinalistsPage({ schedule, now, stage, finalists, load, error, onRetry, onRetrySchedule }) {
  const announced = stage === 'announced' && load === 'ready' && finalists;
  return <div className="finalists-page">
    <div className="fin-lanterns" aria-hidden="true">{LANTERNS.map(l => <i key={l} className={`fin-lantern ${l}`}/>)}</div>
    <FinalistsHero/>
    {announced ? <Announced finalists={finalists}/>
      : stage === 'announced' && (load === 'loading' || load === 'idle') ? <div className="empty-state fin-loading" role="status">Unveiling the royal ten…</div>
      : <Waiting schedule={schedule} now={now} stage={stage} load={load} error={error} onRetry={onRetry} onRetrySchedule={onRetrySchedule}/>}
    <footer className="fin-footer">
      <h3>May Your Light Shine Forever ✦</h3>
      <p>THADINGYUT FESTIVAL 2026<br/>A CELEBRATION OF LIGHT, CULTURE &amp; TOGETHERNESS</p>
    </footer>
  </div>;
}
