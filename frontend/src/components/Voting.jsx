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
