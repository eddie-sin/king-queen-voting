import { useRef, useState } from 'react';
import { request } from './api.js';
export default function EventControls({ controls, ballotCount, staff, token, loading, onSaved, onRefresh, report, notify, messages }) {
  const [busy, setBusy] = useState(''), [confirm, setConfirm] = useState(false), [phrase, setPhrase] = useState('');
  const pending = useRef(null);
  const can = action => staff?.role === 'admin' || staff?.permissions?.includes(action);
  const closed = controls?.votingStatus === 'closed', hidden = controls?.announcementOpen === false;
  async function run(action) {
    if (!controls || busy) return;
    setBusy(action);
    const previous = pending.current;
    const command = previous?.action === action ? previous : { action, operationId: crypto.randomUUID(), revision: controls.revision };
    pending.current = command;
    try {
      const data = await request(`/admin/controls/${action}`, { token, method: 'POST', body: { operationId: command.operationId, revision: command.revision, ...(action === 'votes.clear' ? { confirmation: phrase } : {}) } });
      pending.current = null; onSaved(data); setConfirm(false); setPhrase('');
      notify(action === 'votes.clear' ? `Cleared ${data.clearedBallots} votes. Accounts and content were kept.` : 'Event controls updated.');
    } catch (error) {
      if (error.status >= 400 && error.status < 500) pending.current = null;
      report(error); await onRefresh();
    } finally { setBusy(''); }
  }
  const button = (action, label, allowed = true) => <button type="button" className="button secondary" key={action} disabled={loading || !controls || Boolean(busy) || !allowed || !can(action)} aria-label={label} title={!can(action) ? 'This permission has not been granted.' : undefined} onClick={() => run(action)}>{busy === action ? action === 'voting.close' ? 'Closing voting…' : 'Updating…' : action.startsWith('memory.') ? action.endsWith('.open') ? 'Enable' : 'Disable' : action.endsWith('.open') ? 'Open' : 'Close'}</button>;
  return <div className="event-controls-page"><div className="page-header"><div><p className="eyebrow">MANUAL EVENT CONTROLS</p><h1>Manage the <em>event</em></h1><p className="muted">The organisers decide when each part opens. All changes take effect when you use the controls below.</p></div><button className="button secondary" onClick={() => onRefresh()} disabled={loading}>Refresh status</button></div>{messages}
    {!controls ? <p role="status">Event status is unavailable. Refresh before continuing.</p> : <><div className="control-grid">
      <section className="control-card" data-state={controls.registrationOpen ? 'open' : 'closed'}><h2>Registration</h2><strong>{controls.registrationOpen ? 'Open' : 'Closed'}</strong><p>Closing registration keeps existing accounts usable.</p><div className="control-actions">{button('registration.open', 'Open registration', !controls.registrationOpen)}{button('registration.close', 'Close registration', controls.registrationOpen)}</div></section>
      <section className="control-card" data-state={controls.votingStatus}><h2>Voting</h2><strong>{controls.votingStatus === 'closing' ? 'Closing — finishing admitted votes' : controls.votingStatus === 'open' ? 'Open' : 'Closed'}</strong><p>Reopening keeps recorded votes. Accounts may vote again only after all votes are cleared.</p><div className="control-actions">{button('voting.open', 'Open voting', closed && hidden)}{button('voting.close', 'Close voting', !closed)}</div>{!hidden && <p className="small">Close announcement before reopening voting.</p>}</section>
      <section className="control-card" data-state={controls.announcementOpen ? 'open' : 'closed'}><h2>Announcement</h2><strong>{controls.announcementOpen ? 'Visible to students' : 'Hidden'}</strong><p>Show or hide actual candidate vote totals.</p><div className="control-actions">{button('announcement.open', 'Open announcement', closed && hidden)}{button('announcement.close', 'Close announcement', !hidden)}</div>{!closed && <p className="small">Voting must finish closing before announcement can open.</p>}</section>
      <section className="control-card control-card--danger"><h2>Clear all votes</h2><strong>{ballotCount ?? '—'} recorded ballots</strong><p>Deletes both categories’ votes so everyone can vote again. Keeps accounts, candidates and other content.</p><button className="button delete" disabled={loading || Boolean(busy) || !can('votes.clear') || !closed || !hidden} onClick={() => { setConfirm(true); setPhrase(''); }}>Clear all votes</button>{(!closed || !hidden) && <p className="small">Close voting and announcement first.</p>}</section>
      {staff?.role === 'admin' && <section className="control-card" data-state={controls.memoryPhotosEnabled ? 'open' : 'closed'}><h2>Memory Photo submissions</h2><strong>{controls.memoryPhotosEnabled ? 'Enabled' : 'Disabled'}</strong><p>Only higher administrators control submissions and moderation.</p><div className="control-actions">{button('memory.open', 'Enable submissions', !controls.memoryPhotosEnabled)}{button('memory.close', 'Disable submissions', controls.memoryPhotosEnabled)}</div></section>}
    </div><p className="footnote">Candidate changes require voting closed and announcement hidden. Deleting any candidate additionally requires clearing all votes.</p></>}
    {confirm && <div className="overlay center"><section className="modal small-modal" role="alertdialog" aria-modal="true" aria-labelledby="clear-title"><h2 id="clear-title">Delete every recorded vote?</h2><p>This cannot be undone. Students will be able to vote again.</p><label className="field"><span>Type CLEAR ALL VOTES to confirm</span><input value={phrase} onChange={e => setPhrase(e.target.value)} autoComplete="off"/></label><div className="drawer-actions"><button className="button secondary" disabled={Boolean(busy)} onClick={() => setConfirm(false)}>Cancel</button><button className="button delete" disabled={phrase !== 'CLEAR ALL VOTES' || Boolean(busy) || !closed || !hidden || !can('votes.clear')} onClick={() => run('votes.clear')}>{busy ? 'Clearing…' : 'Clear all votes'}</button></div></section></div>}
  </div>;
}
