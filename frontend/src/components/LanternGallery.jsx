import { useEffect, useRef, useState } from 'react';
import {useParticipation,participationMessage} from '../useParticipation.js';
import { Dialog } from './Dialog.jsx';
import './lantern-gallery.css';

function LanternImage({ lantern, detail = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [lantern.url]);
  return <div className={detail ? 'lantern-detail-image' : 'lantern-thumbnail'}>
    {failed ? <span className="lantern-image-fallback">Image unavailable</span> : <img src={lantern.url} alt={lantern.title} style={detail ? undefined : {objectPosition:`${lantern.thumbnailPosition?.x ?? 50}% ${lantern.thumbnailPosition?.y ?? 50}%`}} loading={detail ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} />}
  </div>;
}

export function LanternGallery({
  lanterns,
  state,
  error,
  onRetry,
  api,
  session,
  onRequireLogin,
}) {
  const participationAllowed=useParticipation(api);
  const [status, setStatus] = useState(null);
  const [mine, setMine] = useState(null);
  const [owner, setOwner] = useState(null);
  const [detail, setDetail] = useState(null);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const version = useRef(0);
  const lock = useRef(false);
  const token = session?.token;

  async function refresh() {
    const n = ++version.current;
    try {
      const [next, own] = await Promise.all([
        api.lanternStatus(),
        token ? api.myLanternVote(token) : Promise.resolve({ vote: null }),
      ]);
      if (n !== version.current) return;
      setStatus(next);
      setMine(own.vote?.lantern || null);
      setOwner(token);
      setMessage('');
    } catch (e) {
      if (n === version.current) {
        setStatus(null);
        setMessage(e.message);
      }
    }
  }

  useEffect(() => {
    setStatus(null);
    setMine(null);
    setPending(null);
    refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    return () => {
      version.current++;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [api, token]);

  async function vote() {
    if (!participationAllowed || lock.current || !pending || !status?.open) return;
    lock.current = true;
    setBusy(true);
    const n = version.current;
    try {
      await api.voteLantern(token, pending._id, status.window);
      if (n !== version.current) return;
      setPending(null);
      await refresh();
      setMessage('Your lantern vote is recorded.');
    } catch (e) {
      if (n === version.current) {
        setPending(null);
        await refresh();
        setMessage(e.reason==='PARTICIPATION_REQUIRED'?e.message:
          `${e.message} Your vote may have been recorded; check your selection before retrying.`,
        );
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const selected = owner === token ? mine : null;

  if (state === 'loading') return <p role="status">Loading lanterns…</p>;
  if (state === 'error') {
    return (
      <div className="empty-state">
        <p>{error}</p>
        <button className="btn secondary" onClick={onRetry}>
          Retry lanterns
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="schedule-banner">
        <span className="schedule-dot" aria-hidden="true" />
        <div>
          <strong>
            {status?.open
              ? 'Lantern voting is open'
              : status
                ? 'Lantern voting is closed'
                : 'Checking lantern voting…'}
          </strong>
          <p>One account, one final lantern vote. You cannot change or remove it.</p>
          {selected && (
            <p>
              Your vote is recorded
              {lanterns.find(l => l._id === selected)?.title
                ? ` for ${lanterns.find(l => l._id === selected).title}`
                : ''}
              .
            </p>
          )}
        </div>
      </div>

      {!participationAllowed && <p className="lantern-access-note" role="status">{participationMessage}</p>}
      {message && (
        <p className="lantern-status-message" role="status">
          {message}
        </p>
      )}

      {status?.announced && status.winner && (
        <section className="source-section">
          <p className="eyebrow">WINNING LANTERN</p>
          <h2>{status.winner.lantern.title}</h2>
          <p>{status.winner.votes} votes</p>
          <img
            src={status.winner.lantern.url}
            alt={status.winner.lantern.title}
            style={{ maxWidth: '100%', maxHeight: 400 }}
          />
        </section>
      )}

      {!lanterns.length ? (
        <div className="empty-state">
          <h3>The gallery is preparing.</h3>
          <p>No lanterns yet.</p>
        </div>
      ) : (
        <div className="lantern-grid">
          {lanterns.map(lantern => (
            <article className={`lantern-card lantern-summary ${selected === lantern._id ? 'is-selected' : ''}`} key={lantern._id}>
              <LanternImage lantern={lantern} />
              {selected === lantern._id && <span className="lantern-recorded-badge">Your recorded vote</span>}
              <div className="lantern-summary-copy">
                <h2 title={lantern.title}>{lantern.title}</h2>
                <button className="btn secondary full-width" aria-label={`View lantern: ${lantern.title}`} onClick={event => { event.currentTarget.focus(); setDetail(lantern); }}>
                  View lantern <span aria-hidden="true">↗</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {detail && (
        <Dialog title={detail.title} onClose={() => setDetail(null)} className="lantern-detail-dialog" dismissOnBackdrop>
          <div className="lantern-detail-layout">
            <div className="lantern-detail-art"><LanternImage lantern={detail} detail />
              <a className="lantern-original-link" href={detail.url} target="_blank" rel="noopener noreferrer">Open original image <span aria-hidden="true">↗</span></a>
            </div>
            <div className="lantern-detail-copy">
              <p className="eyebrow">FESTIVAL LANTERN</p>
              <h3>{detail.title}</h3>
              <div className="lantern-description">{detail.description || 'A little light, shared with our festival community.'}</div>
              <div className="lantern-detail-action">
                {!participationAllowed && <p role="status">{participationMessage}</p>}
                <button className="btn primary full-width" disabled={!participationAllowed || busy || !status?.open || Boolean(selected) || (Boolean(token) && owner !== token)} onClick={() => token ? setPending(detail) : onRequireLogin()}>
                  {selected === detail._id ? 'Your recorded vote' : selected ? 'Already voted' : token ? 'Vote for this lantern' : 'Sign in to vote'}
                </button>
                <p className="fine-print">{selected ? 'Your final choice has been saved.' : status?.open ? 'One lantern, one final choice.' : 'Explore the lanterns. Voting is currently closed.'}</p>
              </div>
            </div>
          </div>
        </Dialog>
      )}

      {pending && (
        <Dialog
          title="Confirm your lantern vote"
          onClose={() => setPending(null)}
          locked={busy}
          className="confirm-dialog"
        >
          <p>
            Vote for <strong>{pending.title}</strong>? This choice is final.
          </p>
          <div className="actions">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={!participationAllowed || busy || !status?.open || Boolean(selected)}
              onClick={vote}
            >
              {busy ? 'Recording…' : 'Confirm final vote'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
