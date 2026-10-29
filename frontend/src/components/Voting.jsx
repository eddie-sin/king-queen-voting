import { useT } from '../i18n/Language.jsx';
import { useEffect, useState } from 'react';
import { Crown, UserIcon } from './Artwork.jsx';
import { Dialog } from './Dialog.jsx';
import { titleCase } from '../domain.js';

export function StatusBanner({ status, error, onRetry }) {
  const t = useT();
  const headline = {
    open: 'Voting is open',
    closing: 'Voting is closing',
    closed: 'Voting is closed',
    unknown: 'Checking voting status',
  }[status];

  return (
    <div className={`schedule-banner ${status}`} role="status">
      <span className="schedule-dot" aria-hidden="true" />
      <div>
        <strong>{t(headline)}</strong>
        <p>
          {t(status === 'open'
            ? 'Choose carefully. You can vote once for King and once for Queen.'
            : status === 'closing'
              ? 'The organisers are finishing votes already being processed. New votes are closed.'
              : status === 'closed'
                ? 'The organisers will open voting when it is time. Your recorded choices remain available in your account.'
                : 'Voting stays unavailable until the server confirms its status.')}
        </p>
        {error && <p className="inline-error">{t(error)}</p>}
      </div>
      {status === 'unknown' && (
        <button className="btn secondary" onClick={onRetry}>{t("Refresh status")}</button>
      )}
    </div>
  );
}

export function AccountPanel({
  session,
  choices,
  choiceState,
  busy,
  onLogin,
  onRegister,
  onSignOut,
}) {
  const t = useT();
  if (!session) {
    return (
      <section className="source-section account-panel">
        <div className="account-card account-guest-card">
          <div className="account-avatar" aria-hidden="true">
            <Crown />
          </div>
          <div className="account-guest-copy">
            <span className="eyebrow">{t("FESTIVAL ACCOUNT")}</span>
            <h2>{t("Sign in to view your votes")}</h2>
            <p>{t("Your King and Queen votes, lanterns, and festival wishes are saved to your account. Each submitted vote is final.")}</p>
            <div className="account-guest-actions">
              <button className="btn primary" onClick={onLogin}>{t("Sign in")}</button>
              <button className="btn secondary" onClick={onRegister}>{t("Create account")}</button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="source-section account-panel">
      <div className="account-card">
        <div className="account-card-head">
          <div className="account-identity">
            <div className="account-avatar is-logged-in" aria-hidden="true">
              <UserIcon />
            </div>
            <div className="account-identity-text">
              <span className="eyebrow">{t("YOUR FESTIVAL ACCOUNT")}</span>
              <h2>{session.user.email}</h2>
            </div>
          </div>
          <div className="account-head-actions">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => onSignOut()}
            >{t("Sign out")}</button>
          </div>
        </div>
        <div className="account-stats-grid">
          {['king', 'queen'].map(contest => (
            <div
              className={`account-stat-box ${choices[contest] ? 'has-voted' : ''}`}
              key={contest}
            >
              <span className="eyebrow">{t(contest.toUpperCase())}{t(" VOTE")}</span>
              <strong>
                {t(choiceState !== 'ready'
                  ? 'Checking…'
                  : choices[contest]
                    ? 'Vote recorded'
                    : 'Not voted yet')}
              </strong>
              <p>
                {choiceState === 'ready' && choices[contest]
                  ? choices[contest].fullName
                  : t('One final choice for this category.')}
              </p>
            </div>
          ))}
          <div className="account-stat-box">
            <span className="eyebrow">{t("YOUR BALLOTS")}</span>
            <strong>{t("One vote per category")}</strong>
            <p>{t("Votes cannot be changed or removed after submission.")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ChoicesPage({
  status,
  session,
  choices,
  choiceState,
  busy,
  onLogin,
  onRefresh,
  onBrowse,
}) {
  const t = useT();
  return (
    <section className="source-section choices-panel" id="choices">
      <div className="choices-section-head">
        <span className="eyebrow">{t("MY RECORDED VOTES")}</span>
        <h2>{t("Your ")}<em>{t("King & Queen")}</em>{t(" choices")}</h2>
      </div>
      {!session ? (
        <div className="choice-gate">
          <div className="choice-gate-copy">
            <span className="eyebrow">{t("BALLOT STATUS")}</span>
            <h3>{t("Sign in to view your votes")}</h3>
            <p>{t("Sign in with your festival account to see your recorded choices or choose a King and Queen.")}</p>
          </div>
          <button className="btn primary" onClick={onLogin}>{t("Sign in")}</button>
        </div>
      ) : (
        <>
          <div className="choice-toolbar">
            <p>
              {t(choiceState === 'ready'
                ? 'These choices are saved to your account.'
                : 'Confirm your saved choices before voting.')}
            </p>
            <button className="text-button" onClick={onRefresh} disabled={busy}>{t("Refresh choices")}</button>
          </div>
          {choiceState !== 'ready' ? (
            <p role="status">
              {t(choiceState === 'uncertain'
                ? 'Your choices could not be confirmed. Please refresh.'
                : 'Checking your saved choices…')}
            </p>
          ) : (
            <div className="choice-grid">
              {['king', 'queen'].map(contest => (
                <article
                  className={`choice-slot ${choices[contest] ? 'has-choice' : ''}`}
                  key={contest}
                >
                  <div className="choice-portrait">
                    {choices[contest]?.images?.[0] ? (
                      <img src={choices[contest].images[0]} alt="" />
                    ) : (
                      <Crown />
                    )}
                  </div>
                  <div className="choice-details">
                    <span className="eyebrow">{t("YOUR ")}{t(contest.toUpperCase())}{t(" VOTE")}</span>
                    <h3>{choices[contest]?.fullName || t('No vote recorded')}</h3>
                    <p>
                      {t(choices[contest]
                        ? 'Your vote is recorded and cannot be changed.'
                        : status === 'open'
                          ? `Choose your ${titleCase(contest)} when you are ready.`
                          : 'You can make your choice when voting opens.')}
                    </p>
                    {!choices[contest] && status === 'open' && (
                      <button
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => onBrowse(contest)}
                      >{t("Choose a ")}{t(titleCase(contest))}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      <div className="source-page-links">
        <button className="text-button" onClick={() => onBrowse('candidates')}>{t("Browse candidates")}</button>
      </div>
    </section>
  );
}

export function VoteConfirmation({ pending, busy, canConfirm, onConfirm, onClose }) {
  const t = useT();
  return (
    <Dialog
      title={t("Confirm your final choice.")}
      locked={busy}
      onClose={onClose}
      className="confirm-dialog"
    >
      <div className="dialog-ornament">
        <Crown />
      </div>
      <p>{t('Cast your {0} vote for', [titleCase(pending.contest)])}{' '}
        <strong>{pending.candidate.fullName}</strong>{t('?')}
      </p>
      <p className="fine-print">{t("You cannot change or remove this vote after submitting. Your other category is a separate choice.")}</p>
      {!canConfirm && (
        <p className="inline-error" role="alert">{t("Voting or your account status changed. Close this dialog and refresh.")}</p>
      )}
      <div className="actions">
        <button className="btn secondary" disabled={busy} onClick={onClose}>{t("Keep browsing")}</button>
        <button
          className="btn primary"
          disabled={busy || !canConfirm}
          onClick={onConfirm}
        >
          {t(busy ? 'Recording…' : 'Confirm vote')}
        </button>
      </div>
    </Dialog>
  );
}

export function Celebration({ event }) {
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!event) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 5200);
    return () => clearTimeout(timer);
  }, [event]);

  if (!visible) return null;

  return (
    <div className="vote-celebration" aria-hidden="true">
      <div className="sparkle-swish" />
      <div className="crown-moment">
        <Crown />
        <strong>{t("A little choice.")}<em>{t("A brighter celebration.")}</em>
        </strong>
        <span>{t("Your vote is saved")}</span>
      </div>
      {Array.from({ length: 32 }, (_, i) => (
        <i
          key={i}
          className="confetti"
          style={{
            '--left': `${(i * 31) % 100}%`,
            '--delay': `${2.5 + (i % 7) * 0.07}s`,
            '--turn': `${i * 29}deg`,
          }}
        />
      ))}
    </div>
  );
}
