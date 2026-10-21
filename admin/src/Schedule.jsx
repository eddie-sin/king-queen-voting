import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { request } from './api.js';

const OFFSET_MS = 390 * 60 * 1000;
const CALENDAR_FIELDS = ['registrationClosesAt', 'votingOpensAt', 'votingClosesAt', 'resultsPublishedAt'];
const ALL_DATE_FIELDS = ['candidateManagementClosesAt', ...CALENDAR_FIELDS];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const META = {
  registrationClosesAt: { label: 'Account creation deadline', short: 'Account deadline', icon: 'users', tone: 'registration' },
  votingOpensAt: { label: 'Voting opens (start)', short: 'Voting opens', icon: 'vote', tone: 'voting' },
  votingClosesAt: { label: 'Voting closes (end)', short: 'Voting closes', icon: 'lock', tone: 'voting' },
  resultsPublishedAt: { label: 'Results announcement', short: 'Results', icon: 'crown', tone: 'results' },
};

const OVERRIDE_OPTIONS = [
  { id: 'auto', label: 'Auto (Schedule)' },
  { id: 'open', label: 'Force Open' },
  { id: 'closed', label: 'Force Close' },
];

// The API speaks Myanmar wall-clock time ("…+06:30"). Inputs hold that same
// wall-clock value without the offset, whatever the admin device's time zone is.
const toLocal = (iso) => (iso ? iso.slice(0, 16) : '');
const nowLocal = () => new Date(Date.now() + OFFSET_MS).toISOString().slice(0, 16);
const toMs = (local) => Date.parse(`${local}:00+06:30`);

const fmtDate = (local) => (local ? new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Yangon',
}).format(toMs(local)) : '—');

const fmtTime = (local) => (local ? `${local.slice(11, 16)} MMT` : '—');

const fmtFull = (local) => (local ? `${fmtDate(local)} · ${fmtTime(local)}` : '—');

const span = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${min}m` : `${min}m`;
};

function validate(d) {
  const errors = {};
  ALL_DATE_FIELDS.forEach((f) => { if (!d[f]) errors[f] = 'Choose a date and time.'; });
  if (d.candidateManagementClosesAt && d.votingOpensAt && d.candidateManagementClosesAt > d.votingOpensAt) {
    errors.candidateManagementClosesAt = 'Candidate management deadline must not be after voting opens.';
  }
  if (d.votingOpensAt && d.votingClosesAt && d.votingClosesAt <= d.votingOpensAt) {
    errors.votingClosesAt = 'Voting must close after it opens.';
  }
  if (d.votingClosesAt && d.resultsPublishedAt && d.resultsPublishedAt <= d.votingClosesAt) {
    errors.resultsPublishedAt = 'Results must come after voting closes.';
  }
  return errors;
}

function buildMonthCells(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0 … Sunday = 6
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < total; i += 1) {
    const d = new Date(Date.UTC(year, month, 1 - lead + i));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const ymd = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({
      ymd,
      day: String(day).padStart(2, '0'),
      inMonth: y === year && m === month,
    });
  }
  return cells;
}

function defaultBaseMonth(saved) {
  const locales = CALENDAR_FIELDS.map((f) => saved[f]).filter(Boolean).sort();
  if (!locales.length) return { year: 2026, month: 9 };
  const first = locales[0];
  return { year: Number(first.slice(0, 4)), month: Number(first.slice(5, 7)) - 1 };
}

function shiftMonth({ year, month }, delta) {
  const d = new Date(Date.UTC(year, month + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

function Sparkle() {
  return (
    <svg className="cal-sparkle" width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M14 2C14.7 9.2 18.8 13.3 26 14C18.8 14.7 14.7 18.8 14 26C13.3 18.8 9.2 14.7 2 14C9.2 13.3 13.3 9.2 14 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function MonthGrid({ year, month, eventsByDate, voteStartYmd, voteEndYmd }) {
  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);
  const monthName = MONTHS[month].toUpperCase();
  return (
    <div className="cal-month">
      <div className="cal-month-side" aria-label={`${MONTHS[month]} ${year}`}>
        <span>{monthName}</span>
      </div>
      <div className="cal-month-body">
        <div className="cal-weekdays" aria-hidden="true">
          {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
        </div>
        <div className="cal-grid">
          {cells.map((cell) => {
            const events = eventsByDate[cell.ymd] || [];
            const hasEvent = events.length > 0;
            const inVoting = !hasEvent && voteStartYmd && voteEndYmd && cell.ymd > voteStartYmd && cell.ymd < voteEndYmd;
            const toneClass = hasEvent ? `tone-${events[0].tone}` : '';
            const stateClass = !cell.inMonth
              ? 'outside'
              : hasEvent
                ? `highlight ${toneClass}`
                : inVoting
                  ? 'voting-span'
                  : '';
            return (
              <div
                key={cell.ymd}
                className={`cal-cell ${stateClass}`}
                title={events.length ? events.map((e) => `${e.label} (${e.time} MMT)`).join(' · ') : undefined}
              >
                <span className="cal-day">{cell.day}</span>
                {hasEvent && (
                  <div className="cal-events">
                    {events.map((ev) => (
                      <div key={ev.field} className="cal-event">
                        <strong>{ev.short}</strong>
                        <span>{ev.time}</span>
                      </div>
                    ))}
                  </div>
                )}
                {inVoting && cell.inMonth && (
                  <div className="cal-events">
                    <div className="cal-event">
                      <strong>Voting</strong>
                      <span>Open</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ModalDateField({ field, label, hint, draft, saved, errors, set, min, max }) {
  const id = `schedule-${field}`;
  const changed = draft[field] !== saved[field];
  return (
    <div className={`field req ${errors[field] ? 'invalid' : ''}`}>
      <label htmlFor={id} className="sched-modal-label">
        <span>{label}<b className="req-star" aria-label="required">*</b></span>
        {changed && <button type="button" className="undo-link" onClick={() => set(field, saved[field])}>Reset</button>}
      </label>
      <input
        id={id}
        className="sched-input"
        type="datetime-local"
        value={draft[field]}
        min={min}
        max={max}
        required
        onChange={(e) => set(field, e.target.value)}
      />
      {errors[field]
        ? <small className="field-error" role="alert">{errors[field]}</small>
        : <small>{fmtFull(draft[field])}{hint ? ` · ${hint}` : ''}</small>}
    </div>
  );
}

export default function SchedulePanel({ schedule, token, loading, onSaved, report, notify, messages }) {
  const saved = useMemo(() => {
    const map = Object.fromEntries(ALL_DATE_FIELDS.map((f) => [f, toLocal(schedule?.[f])]));
    if (!map.candidateManagementClosesAt && schedule) {
      map.candidateManagementClosesAt = '2026-10-27T23:59';
    }
    return map;
  }, [schedule]);
  const [baseMonth, setBaseMonth] = useState(() => defaultBaseMonth(saved));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(saved);
  const [modalError, setModalError] = useState('');
  const [saving, setSaving] = useState(false);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearingVotes, setClearingVotes] = useState(false);

  useEffect(() => {
    setBaseMonth(defaultBaseMonth(saved));
    setDraft(saved);
  }, [saved]);

  // Only the 4 student-facing milestones appear on the Calendar grid.
  const eventsByDate = useMemo(() => {
    const map = {};
    CALENDAR_FIELDS.forEach((field) => {
      const local = saved[field];
      if (!local) return;
      const ymd = local.slice(0, 10);
      const time = local.slice(11, 16);
      if (!map[ymd]) map[ymd] = [];
      map[ymd].push({ field, short: META[field].short, label: META[field].label, tone: META[field].tone, time });
    });
    return map;
  }, [saved]);

  const header = (
    <div className="page-header">
      <div>
        <p className="eyebrow">FESTIVAL ADMINISTRATION · 2026</p>
        <h1>Election <em>Schedule</em></h1>
        <p className="muted">Key dates for account creation, voting, and finalist results.</p>
      </div>
      <span className="tz-chip"><Icon name="clock" size={15} /> Myanmar Time · UTC+06:30</span>
    </div>
  );

  if (!schedule) {
    return (
      <div className="schedule-page">
        {header}
        {messages}
        <div className="empty">{loading ? 'Loading schedule…' : 'The schedule could not be loaded. Try refreshing.'}</div>
      </div>
    );
  }

  const secondMonth = shiftMonth(baseMonth, 1);
  const voteStartYmd = saved.votingOpensAt ? saved.votingOpensAt.slice(0, 10) : '';
  const voteEndYmd = saved.votingClosesAt ? saved.votingClosesAt.slice(0, 10) : '';
  const votingDuration = saved.votingOpensAt && saved.votingClosesAt && saved.votingClosesAt > saved.votingOpensAt
    ? span(toMs(saved.votingClosesAt) - toMs(saved.votingOpensAt))
    : null;

  const set = (field, value) => setDraft((d) => ({ ...d, [field]: value }));
  const dirty = ALL_DATE_FIELDS.filter((f) => draft[f] !== saved[f]);
  const errors = validate(draft);
  const hasErrors = Object.keys(errors).length > 0;
  const locked = Boolean(schedule.candidateManagementLocked);
  const votingOverride = schedule.votingOverride || 'auto';
  const votingOpen = Boolean(schedule.isVotingOpen);
  const now = nowLocal();
  const canClearTestVotes = Boolean(saved.votingOpensAt && now < saved.votingOpensAt);
  const lateRegistration = draft.registrationClosesAt && draft.votingClosesAt && draft.registrationClosesAt > draft.votingClosesAt;

  function openEdit() {
    setDraft(saved);
    setModalError('');
    setEditing(true);
  }

  function closeEdit() {
    if (saving) return;
    setEditing(false);
    setModalError('');
  }

  async function save(e) {
    e.preventDefault();
    if (!dirty.length) {
      setEditing(false);
      return;
    }
    if (hasErrors || saving) return;
    setSaving(true);
    setModalError('');
    try {
      const body = Object.fromEntries(dirty.map((f) => [f, `${draft[f]}+06:30`]));
      const data = await request('/admin/settings', { token, method: 'PATCH', body });
      onSaved(data.schedule);
      setEditing(false);
      notify('Election schedule updated.');
    } catch (err) {
      setModalError(err.message || 'Could not update schedule.');
      if (err.status === 401 || err.status === 403) {
        setEditing(false);
        report(err);
      }
    } finally {
      setSaving(false);
    }
  }

  async function changeVotingOverride(nextOverride) {
    if (nextOverride === votingOverride || overrideBusy) return;
    setOverrideBusy(true);
    try {
      const data = await request('/admin/settings', {
        token,
        method: 'PATCH',
        body: { votingOverride: nextOverride },
      });
      onSaved(data.schedule);
      const msg = nextOverride === 'open'
        ? 'Voting forced open.'
        : nextOverride === 'closed'
          ? 'Voting forced closed.'
          : 'Voting returned to automatic schedule.';
      notify(msg);
    } catch (err) {
      report(err);
    } finally {
      setOverrideBusy(false);
    }
  }

  async function handleClearTestVotes() {
    setClearingVotes(true);
    try {
      const data = await request('/admin/test-votes', { token, method: 'DELETE' });
      const count = data?.clearedBallots ?? 0;
      setConfirmClear(false);
      notify(count ? `Cleared ${count} test ballot${count === 1 ? '' : 's'} and reset voter status.` : 'All test votes cleared (0 ballots were stored).');
    } catch (err) {
      setConfirmClear(false);
      report(err);
    } finally {
      setClearingVotes(false);
    }
  }

  return (
    <div className="schedule-page">
      {header}
      {messages}

      <section className="cal-card" aria-label="Election calendar">
        <div className="cal-header">
          <div className="cal-title">
            <Sparkle />
            <h2>CALENDAR</h2>
          </div>
          <div className="cal-nav" role="group" aria-label="Calendar month navigation">
            <button
              type="button"
              className="cal-arrow"
              aria-label="Previous month"
              onClick={() => setBaseMonth((m) => shiftMonth(m, -1))}
            >
              ‹
            </button>
            <span className="cal-range-label">
              {MONTHS[baseMonth.month]} – {MONTHS[secondMonth.month]} {secondMonth.year}
            </span>
            <button
              type="button"
              className="cal-arrow"
              aria-label="Next month"
              onClick={() => setBaseMonth((m) => shiftMonth(m, 1))}
            >
              ›
            </button>
          </div>
        </div>

        <div className="cal-months">
          <MonthGrid
            year={baseMonth.year}
            month={baseMonth.month}
            eventsByDate={eventsByDate}
            voteStartYmd={voteStartYmd}
            voteEndYmd={voteEndYmd}
          />
          <MonthGrid
            year={secondMonth.year}
            month={secondMonth.month}
            eventsByDate={eventsByDate}
            voteStartYmd={voteStartYmd}
            voteEndYmd={voteEndYmd}
          />
        </div>
      </section>

      <section className="ops-deck" aria-label="Admin cutoff and voting controls">
        <article className="ops-panel">
          <div className="ops-top">
            <span className="ops-tag"><Icon name="lock" size={13} /> INTERNAL ADMIN CUTOFF</span>
            <span className={`pill ${locked ? 'inactive' : 'active'}`}>
              <i />{locked ? 'CRUD Locked' : 'CRUD Open'}
            </span>
          </div>
          <h3>Candidate management deadline</h3>
          <p className="ops-desc">
            Adding, editing, or deleting candidates is allowed until this deadline. Must be on or before Voting Start.
          </p>
          <div className="ops-deadline-box">
            <div>
              <span className="ops-box-label">CLOSES AT</span>
              <strong>{fmtDate(saved.candidateManagementClosesAt)}</strong>
            </div>
            <span className="ops-box-time">{fmtTime(saved.candidateManagementClosesAt)}</span>
          </div>
        </article>

        <article className="ops-panel">
          <div className="ops-top">
            <span className="ops-tag"><Icon name="vote" size={13} /> VOTING CONTROL &amp; TESTING</span>
            <span className={`pill ${votingOpen ? 'active' : 'inactive'}`}>
              <i />{votingOpen ? 'Voting Open' : 'Voting Closed'}
            </span>
          </div>
          <h3>Voting status override</h3>
          <p className="ops-desc">
            Follow the scheduled dates automatically, or force voting open/closed for testing.
          </p>
          <div className="override-switch" role="group" aria-label="Voting status mode">
            {OVERRIDE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={overrideBusy}
                className={votingOverride === opt.id ? `selected mode-${opt.id}` : ''}
                onClick={() => changeVotingOverride(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="ops-test-row">
            <span className="ops-test-hint">
              {canClearTestVotes
                ? 'Reset all test ballots and voter flags to 0 before real voting begins.'
                : 'Test vote reset is disabled once the scheduled voting date begins.'}
            </span>
            <button
              type="button"
              className="button secondary small-btn"
              disabled={!canClearTestVotes || clearingVotes}
              onClick={() => setConfirmClear(true)}
            >
              <Icon name="trash" size={14} /> Clear test votes
            </button>
          </div>
        </article>
      </section>

      <section className="info-section" aria-label="Scheduled dates">
        <div className="info-list">
          <article className="info-card tone-registration">
            <div className="info-head">
              <span className="info-icon"><Icon name="users" size={18} /></span>
              <div>
                <span className="info-step">01 · REGISTRATION</span>
                <h3>Account creation deadline</h3>
                <p>Students can create an account and receive their voting key until this time.</p>
              </div>
            </div>
            <div className="info-values">
              <div className="info-time-block">
                <span className="info-time-label">DEADLINE</span>
                <strong>{fmtDate(saved.registrationClosesAt)}</strong>
                <span className="info-clock">{fmtTime(saved.registrationClosesAt)}</span>
              </div>
            </div>
          </article>

          <article className="info-card tone-voting">
            <div className="info-head">
              <span className="info-icon"><Icon name="vote" size={18} /></span>
              <div>
                <span className="info-step">02 · VOTING WINDOW {votingDuration ? `· ${votingDuration}` : ''}</span>
                <h3>Voting period</h3>
                <p>Students can cast, update, or remove their King and Queen votes during this period.</p>
              </div>
            </div>
            <div className="info-values pair">
              <div className="info-time-block">
                <span className="info-time-label">START</span>
                <strong>{fmtDate(saved.votingOpensAt)}</strong>
                <span className="info-clock">{fmtTime(saved.votingOpensAt)}</span>
              </div>
              <span className="info-arrow" aria-hidden="true">→</span>
              <div className="info-time-block">
                <span className="info-time-label">END</span>
                <strong>{fmtDate(saved.votingClosesAt)}</strong>
                <span className="info-clock">{fmtTime(saved.votingClosesAt)}</span>
              </div>
            </div>
          </article>

          <article className="info-card tone-results">
            <div className="info-head">
              <span className="info-icon"><Icon name="crown" size={18} /></span>
              <div>
                <span className="info-step">03 · FINALISTS</span>
                <h3>Results announcement</h3>
                <p>The top 5 King and Queen finalists are published to the public website after this time.</p>
              </div>
            </div>
            <div className="info-values">
              <div className="info-time-block">
                <span className="info-time-label">ANNOUNCEMENT</span>
                <strong>{fmtDate(saved.resultsPublishedAt)}</strong>
                <span className="info-clock">{fmtTime(saved.resultsPublishedAt)}</span>
              </div>
            </div>
          </article>
        </div>

        <div className="info-footer">
          <p className="footnote">
            All dates and times are in Myanmar Time (UTC+06:30).
          </p>
          <button type="button" className="button primary" onClick={openEdit}>
            <Icon name="edit" size={16} /> Edit election dates
          </button>
        </div>
      </section>

      {editing && (
        <div className="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) closeEdit(); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="edit-schedule-title" className="modal wizard sched-modal">
            <header className="wizard-head">
              <div>
                <p className="eyebrow">ELECTION SCHEDULE · MMT (UTC+06:30)</p>
                <h2 id="edit-schedule-title">Edit election dates</h2>
              </div>
              <button type="button" className="icon-button" onClick={closeEdit} aria-label="Close">
                <Icon name="x" />
              </button>
            </header>

            <form onSubmit={save} className="wizard-form" noValidate>
              <div className="wizard-scroll">
                <div className="sched-modal-section">
                  <h4>Candidate management (CRUD)</h4>
                  <ModalDateField
                    field="candidateManagementClosesAt"
                    label="Candidate management deadline"
                    hint="Must be ≤ voting start"
                    draft={draft}
                    saved={saved}
                    errors={errors}
                    set={set}
                    max={draft.votingOpensAt}
                  />
                </div>

                <div className="sched-modal-section">
                  <h4>Account creation deadline</h4>
                  <ModalDateField
                    field="registrationClosesAt"
                    label="Deadline date & time"
                    draft={draft}
                    saved={saved}
                    errors={errors}
                    set={set}
                  />
                </div>

                <div className="sched-modal-section">
                  <h4>Voting period</h4>
                  <div className="form-grid">
                    <ModalDateField
                      field="votingOpensAt"
                      label="Voting start"
                      draft={draft}
                      saved={saved}
                      errors={errors}
                      set={set}
                    />
                    <ModalDateField
                      field="votingClosesAt"
                      label="Voting end"
                      draft={draft}
                      saved={saved}
                      errors={errors}
                      set={set}
                      min={draft.votingOpensAt}
                    />
                  </div>
                </div>

                <div className="sched-modal-section">
                  <h4>Results announcement</h4>
                  <ModalDateField
                    field="resultsPublishedAt"
                    label="Announcement date & time"
                    draft={draft}
                    saved={saved}
                    errors={errors}
                    set={set}
                    min={draft.votingClosesAt}
                  />
                </div>

                {lateRegistration && (
                  <p className="sched-note warn">
                    <Icon name="alert" size={15} />
                    Account creation deadline is after voting closes, so students registering after voting ends will not be able to vote.
                  </p>
                )}

                {modalError && <div className="message error" role="alert" style={{ marginTop: 14, marginBottom: 0 }}>{modalError}</div>}
              </div>

              <div className="drawer-actions wizard-actions">
                <button type="button" className="button secondary" onClick={closeEdit} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="button primary" disabled={!dirty.length || hasErrors || saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {confirmClear && (
        <div className="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget && !clearingVotes) setConfirmClear(false); }}>
          <section role="alertdialog" aria-modal="true" aria-labelledby="clear-votes-title" className="modal small-modal">
            <div className="warning-symbol"><Icon name="trash" size={25} /></div>
            <h2 id="clear-votes-title">Clear all test votes?</h2>
            <p className="muted">
              This deletes all current ballots so every candidate returns to <strong>0 votes</strong>, and resets every user account to <strong>not voted yet</strong>. Registered accounts and their voting keys remain active.
            </p>
            <div className="drawer-actions">
              <button type="button" className="button secondary" disabled={clearingVotes} onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
              <button type="button" className="button delete" disabled={clearingVotes} onClick={handleClearTestVotes}>
                {clearingVotes ? 'Clearing…' : 'Yes, clear test votes'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
