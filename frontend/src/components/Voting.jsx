import { useEffect, useState } from 'react';
import { Crown } from './Artwork.jsx';
import { Dialog } from './Dialog.jsx';
import { myanmarTime, titleCase } from '../domain.js';

export function ScheduleBanner({ status, schedule, error, onRetry }) {
  const headline = { open: 'Voting is open', upcoming: 'A moment worth waiting for', closed: 'Voting has closed', unknown: 'Checking the event schedule' }[status];
  return <div className={`schedule-banner ${status}`} role="status"><span className="schedule-dot"/><div><strong>{headline}</strong>
    <p>{status === 'open' ? `Choose your King and Queen before ${myanmarTime(schedule.votingClosesAt)}.` : status === 'upcoming' ? `Voting begins ${myanmarTime(schedule.votingOpensAt)}. Browse the candidates while you wait.` : status === 'closed' ? `Voting ended ${myanmarTime(schedule?.votingClosesAt)}. Your account participation is still available.` : 'Voting actions stay locked until the server schedule is available.'}</p>
    {error && <p className="inline-error">{error}</p>}</div>
    {status === 'unknown' && <button className="btn secondary" onClick={onRetry}>Refresh schedule</button>}
  </div>;
}
export function ChoicesPage({ status, session, choices, choiceState, busy, onLogin, onUnlock, onRefresh, onChange, onRemove, onBrowse, onRetrySchedule }) {
  const open = status === 'open';
  const ready = open && choiceState === 'ready';
  const closed = status === 'closed';
  let gate = null;
  if (status === 'unknown') gate = <><p>The event schedule is unavailable right now. Refresh it to check your choices.</p><button className="btn secondary" onClick={onRetrySchedule}>Refresh schedule</button></>;
  else if (status === 'upcoming') gate = <p>Voting has not started yet. Your choices will appear here once voting opens.</p>;
  else if (!session) gate = <><p>Sign in to see your {closed ? 'participation' : 'saved King and Queen choices'}.</p><button className="btn primary" onClick={onLogin}>Sign in to view</button></>;
  else if (open && choiceState === 'locked') gate = <><p>Enter your private voting key to see the choices saved to this account.</p><button className="btn primary" onClick={onUnlock} disabled={busy}>Enter voting key</button></>;
  else if (open && choiceState === 'loading') gate = <p role="status">Checking your saved choices…</p>;
  else if (open && choiceState === 'uncertain') gate = <><p>We could not verify your saved choices. Refresh them before making a change.</p><button className="btn secondary" onClick={onRefresh} disabled={busy}>Refresh saved choices</button></>;
  return <section className="source-section choices-panel" id="choices" aria-label="My choices">
    {gate ? <div className="choice-gate"><Crown/><div><h2>{closed ? 'Your participation' : 'Your choices are private'}</h2>{gate}</div></div> : <>
      {ready && <div className="choice-toolbar"><div><span className="eyebrow">SAVED TO YOUR ACCOUNT</span><p>Your choices are unlocked for this session.</p></div><button className="text-button" onClick={onRefresh} disabled={busy}>Refresh saved choices</button></div>}
      {closed && <p className="choice-privacy-note">Voting has closed. Candidate names are private now; your account shows whether you voted in each category.</p>}
      <div className="choice-grid">{['king', 'queen'].map(contest => {
        const candidate = ready ? choices[contest] : null;
        const participated = closed && session?.user?.[contest === 'king' ? 'hasVotedKing' : 'hasVotedQueen'];
        return <article className={`choice-slot ${candidate || participated ? 'has-choice' : ''}`} key={contest}>
          <div className="choice-portrait">{candidate?.images?.[0] ? <img src={candidate.images[0]} alt=""/> : <Crown/>}</div>
          <div className="choice-details"><span className="eyebrow">YOUR {contest.toUpperCase()} CHOICE</span><h3>{closed ? participated ? 'Private choice' : 'No vote recorded' : candidate ? candidate.fullName : 'No choice yet'}</h3>
            <p>{closed ? participated ? 'A vote is recorded for this contest.' : 'No vote was recorded for this contest.' : candidate ? 'Your vote is saved. You can change or remove it while voting is open.' : `Explore the ${titleCase(contest)} candidates to make your choice.`}</p>
            {ready && <div className="choice-actions"><button className="btn secondary" onClick={() => onChange(contest)} disabled={busy}>{candidate ? 'Change choice' : `Choose a ${titleCase(contest)}`}</button>{candidate && <button className="text-button remove-choice" onClick={() => onRemove(contest)} disabled={busy}>Remove {titleCase(contest)} vote</button>}</div>}
          </div>
        </article>;
      })}</div>
    </>}
    <div className="source-page-links"><button className="text-button" onClick={() => onBrowse('candidates')}>Browse candidates</button></div>
  </section>;
}
export function VoteConfirmation({ pending, previous, busy, canConfirm, onConfirm, onClose }) {
  const { candidate, contest, action } = pending;
  const label = titleCase(contest);
  return <Dialog title={action === 'remove' ? 'Remove your choice?' : action === 'change' ? 'A change of heart?' : 'Let your choice shine.'} locked={busy} onClose={onClose} className="confirm-dialog">
    <div className="dialog-ornament"><Crown/></div>
    <p>{action === 'remove' ? <>Remove your saved {label} vote for <strong>{candidate.fullName}</strong>?</> : action === 'change' ? <>Change your {label} choice from <strong>{previous?.fullName}</strong> to <strong>{candidate.fullName}</strong>?</> : <>Cast your {label} vote for <strong>{candidate.fullName}</strong>?</>}</p>
    <p className="fine-print">This affects only your {label} choice. {action === 'remove' ? 'You can choose again' : 'You can change or remove it'} while voting is open.</p>
    {!canConfirm && <p className="inline-error" role="alert">Voting is unavailable or choices need refreshing. Close this dialog and review your saved choices.</p>}
    <div className="actions"><button className="btn secondary" disabled={busy} onClick={onClose}>Keep browsing</button><button className="btn primary" disabled={busy || !canConfirm} onClick={onConfirm}>{busy ? 'Saving…' : action === 'remove' ? 'Yes, remove vote' : action === 'change' ? 'Confirm change' : 'Confirm vote'}</button></div>
  </Dialog>;
}
export function Celebration({ event }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (!event) return; setVisible(true); const timer = setTimeout(() => setVisible(false), 5200); return () => clearTimeout(timer); }, [event]);
  if (!visible) return null;
  return <div className="vote-celebration" aria-hidden="true"><div className="sparkle-swish"/><div className="crown-moment"><Crown/><strong>A little choice.<em>A brighter celebration.</em></strong><span>Your vote is saved</span></div>{Array.from({ length: 32 }, (_, i) => <i key={i} className="confetti" style={{ '--left': `${(i * 31) % 100}%`, '--delay': `${2.5 + i % 7 * .07}s`, '--turn': `${i * 29}deg` }}/>)}</div>;
}
