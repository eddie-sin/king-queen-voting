import { useT } from '../i18n/Language.jsx';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog.jsx';

export function LanternGallery({
  lanterns,
  state,
  error,
  onRetry,
  api,
  session,
  onRequireLogin,
}) {
  const t = useT();
  const [status, setStatus] = useState(null);
  const [mine, setMine] = useState(null);
  const [owner, setOwner] = useState(null);
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
    if (lock.current || !pending || !status?.open) return;
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
        setMessage(
          `${e.message} Your vote may have been recorded; check your selection before retrying.`,
        );
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const selected = owner === token ? mine : null;

  if (state === 'loading') return <p role="status">{t("Loading lanterns…")}</p>;
  if (state === 'error') {
    return (
      <div className="empty-state">
        <p>{t(error)}</p>
        <button className="btn secondary" onClick={onRetry}>{t("Retry lanterns")}</button>
      </div>
    );
  }

  return (
    <>
      <div className="schedule-banner">
        <span className="schedule-dot" aria-hidden="true" />
        <div>
          <strong>
            {t(status?.open
              ? 'Lantern voting is open'
              : status
                ? 'Lantern voting is closed'
                : 'Checking lantern voting…')}
          </strong>
          <p>{t("One account, one final lantern vote. You cannot change or remove it.")}</p>
          {selected && (
            <p>{t("Your vote is recorded")}{t(lanterns.find(l => l._id === selected)?.title
                ? ` for ${lanterns.find(l => l._id === selected).title}`
                : '')}
              .
            </p>
          )}
        </div>
      </div>

      {message && (
        <p className="lantern-status-message" role="status">
          {t(message)}
        </p>
      )}

      {status?.announced && status.winner && (
        <section className="source-section">
          <p className="eyebrow">{t("WINNING LANTERN")}</p>
          <h2>{status.winner.lantern.title}</h2>
          <p>{status.winner.votes}{t(" votes")}</p>
          <img
            src={status.winner.lantern.url}
            alt={status.winner.lantern.title}
            style={{ maxWidth: '100%', maxHeight: 400 }}
          />
        </section>
      )}

      {!lanterns.length ? (
        <div className="empty-state">
          <h3>{t("The gallery is preparing.")}</h3>
          <p>{t("No lanterns yet.")}</p>
        </div>
      ) : (
        <div className="lantern-grid">
          {lanterns.map(lantern => (
            <article className="lantern-card" key={lantern._id}>
              <img src={lantern.url} alt={lantern.title} loading="lazy" />
              <div className="lantern-card-body">
                <p className="eyebrow">{t("FESTIVAL LANTERN")}</p>
                <h2>{lantern.title}</h2>
                <p>{lantern.description}</p>
                <button
                  className="btn secondary full-width"
                  disabled={
                    busy ||
                    !status?.open ||
                    Boolean(selected) ||
                    (Boolean(token) && owner !== token)
                  }
                  onClick={() => (token ? setPending(lantern) : onRequireLogin())}
                >
                  {t(selected === lantern._id
                    ? 'Your recorded vote'
                    : selected
                      ? 'Already voted'
                      : token
                        ? 'Vote for this lantern'
                        : 'Sign in to vote')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {pending && (
        <Dialog
          title={t("Confirm your lantern vote")}
          onClose={() => setPending(null)}
          locked={busy}
          className="confirm-dialog"
        >
          <p>{t("Vote for ")}<strong>{pending.title}</strong>{t("? This choice is final.")}</p>
          <div className="actions">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setPending(null)}
            >{t("Cancel")}</button>
            <button
              className="btn primary"
              disabled={busy || !status?.open || Boolean(selected)}
              onClick={vote}
            >
              {t(busy ? 'Recording…' : 'Confirm final vote')}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
