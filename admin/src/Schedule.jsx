import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { request } from './api.js';

const OFFSET_MS = 390 * 60 * 1000;
const FIELDS = ['registrationClosesAt', 'votingOpensAt', 'votingClosesAt', 'resultsPublishedAt'];
const META = {
  registrationClosesAt: { label: 'Registration closes', icon: 'users' },
  votingOpensAt: { label: 'Voting opens', icon: 'vote' },
  votingClosesAt: { label: 'Voting closes', icon: 'lock' },
  resultsPublishedAt: { label: 'Results announced', icon: 'crown' },
};

// The API speaks Myanmar wall-clock time ("…+06:30"). Inputs hold that same
// wall-clock value without the offset, whatever the admin device's time zone is.
const toLocal = (iso) => (iso ? iso.slice(0, 16) : '');
const nowLocal = () => new Date(Date.now() + OFFSET_MS).toISOString().slice(0, 16);
const toMs = (local) => Date.parse(`${local}:00+06:30`);
const fmt = (local) => (local ? new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Yangon',
}).format(toMs(local)) : '—');
const span = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${min}m` : `${min}m`;
};
// Closing deadlines include their whole final minute (the backend stores :59.999).
const isPast = (field, local, now) => (field === 'registrationClosesAt' || field === 'votingClosesAt' ? now > local : now >= local);

function phaseOf(s, now) {
  if (now < s.votingOpensAt) return { tone: 'before', pill: 'Upcoming', title: 'Voting has not started yet', next: 'votingOpensAt' };
  if (now <= s.votingClosesAt) return { tone: 'live', pill: 'Live now', title: 'Voting is live', next: 'votingClosesAt' };
  if (now < s.resultsPublishedAt) return { tone: 'closed', pill: 'Counting', title: 'Voting closed · results pending', next: 'resultsPublishedAt' };
  return { tone: 'done', pill: 'Complete', title: 'Results are published', next: null };
}

// Mirrors the backend rules so problems show up before saving.
function validate(d) {
  const errors = {};
  FIELDS.forEach((f) => { if (!d[f]) errors[f] = 'Choose a date and time.'; });
  if (d.votingOpensAt && d.votingClosesAt && d.votingClosesAt <= d.votingOpensAt) errors.votingClosesAt = 'Voting must close after it opens.';
  if (d.votingClosesAt && d.resultsPublishedAt && d.resultsPublishedAt <= d.votingClosesAt) errors.resultsPublishedAt = 'Results must come after voting closes.';
  return errors;
}

function DateField({ field, draft, saved, errors, set, min }) {
  const id = `schedule-${field}`;
  const changed = draft[field] !== saved[field];
  return (
    <div className={`sched-field ${changed ? 'changed' : ''} ${errors[field] ? 'invalid' : ''}`}>
      <label htmlFor={id}>{META[field].label}{changed && <em className="edited-tag">Edited</em>}</label>
      <input id={id} type="datetime-local" value={draft[field]} min={min} required onChange={(e) => set(field, e.target.value)} />
      {errors[field]
        ? <small className="field-error" role="alert">{errors[field]}</small>
        : changed
          ? <small>Was {fmt(saved[field])} · <button type="button" onClick={() => set(field, saved[field])}>Undo</button></small>
          : <small>{fmt(saved[field])} MMT</small>}
    </div>
  );
}

export default function SchedulePanel({ schedule, token, loading, onSaved, report, notify, messages }) {
  const saved = useMemo(() => Object.fromEntries(FIELDS.map((f) => [f, toLocal(schedule?.[f])])), [schedule]);
  const [draft, setDraft] = useState(saved);
  const [now, setNow] = useState(nowLocal);
  const [saving, setSaving] = useState(false);
  const [confirmLock, setConfirmLock] = useState(false);
  useEffect(() => setDraft(saved), [saved]);
  useEffect(() => { const id = setInterval(() => setNow(nowLocal()), 30000); return () => clearInterval(id); }, []);

  const header = (
    <div className="page-header">
      <div>
        <p className="eyebrow">FESTIVAL ADMINISTRATION · 2026</p>
        <h1>Election <em>Schedule</em></h1>
        <p className="muted">Decide when registration closes, when voting runs, and when results go live.</p>
      </div>
      <span className="tz-chip"><Icon name="clock" size={15} /> Myanmar Time · UTC+06:30</span>
    </div>
  );
  if (!schedule) return <div className="schedule-page">{header}{messages}<div className="empty">{loading ? 'Loading schedule…' : 'The schedule could not be loaded. Try refreshing.'}</div></div>;

  const set = (field, value) => setDraft((d) => ({ ...d, [field]: value }));
  const dirty = FIELDS.filter((f) => draft[f] !== saved[f]);
  const errors = validate(draft);
  const hasErrors = Object.keys(errors).length > 0;
  const locked = Boolean(schedule.candidateManagementLocked);
  const willLock = !locked && dirty.includes('votingOpensAt') && draft.votingOpensAt && draft.votingOpensAt <= now;
  const lateRegistration = draft.registrationClosesAt && draft.votingClosesAt && draft.registrationClosesAt > draft.votingClosesAt;
  const votingWindowOk = draft.votingOpensAt && draft.votingClosesAt && !errors.votingClosesAt;

  async function save() {
    setConfirmLock(false);
    setSaving(true);
    try {
      const body = Object.fromEntries(dirty.map((f) => [f, `${draft[f]}+06:30`]));
      const data = await request('/admin/settings', { token, method: 'PATCH', body });
      onSaved(data.schedule);
      notify('Election schedule saved.');
    } catch (e) { report(e); } finally { setSaving(false); }
  }
  function submit(e) {
    e.preventDefault();
    if (!dirty.length || hasErrors || saving) return;
    if (willLock) setConfirmLock(true); else save();
  }

  // Timeline uses the saved schedule, so it always reflects what students see.
  const phase = phaseOf(saved, now);
  const milestones = FIELDS.map((f) => ({ f, at: saved[f] })).sort((a, b) => toMs(a.at) - toMs(b.at));
  const nextIdx = milestones.findIndex((m) => !isPast(m.f, m.at, now));
  const lastPast = nextIdx === -1 ? milestones.length - 1 : nextIdx - 1;
  let fill = nextIdx === -1 ? 1 : 0;
  if (nextIdx > 0) {
    const a = toMs(milestones[lastPast].at), b = toMs(milestones[nextIdx].at);
    const part = b > a ? Math.min(1, Math.max(0, (Date.now() - a) / (b - a))) : 0;
    fill = (lastPast + part) / (milestones.length - 1);
  }

  return (
    <div className="schedule-page">
      {header}
      {messages}
      <section className={`phase-card ${phase.tone}`} aria-label="Current election status">
        <div className="phase-top">
          <div>
            <span className="phase-pill"><i />{phase.pill}</span>
            <h2>{phase.title}</h2>
            <p className="muted">{phase.next
              ? <>{META[phase.next].label} in <strong>{span(toMs(saved[phase.next]) - Date.now())}</strong> · {fmt(saved[phase.next])} MMT</>
              : 'The election is complete. Finalists are visible to everyone.'}</p>
          </div>
          <span className={`lock-chip ${locked ? 'on' : ''}`}><Icon name="lock" size={15} />{locked ? 'Candidate editing locked' : 'Candidate editing open'}</span>
        </div>
        <ol className="timeline" style={{ '--fill': fill }}>
          {milestones.map((m, i) => (
            <li key={m.f} className={`${i <= lastPast ? 'past' : ''} ${i === nextIdx ? 'next' : ''}`}>
              <span className="tl-dot"><Icon name={META[m.f].icon} size={16} /></span>
              <strong>{META[m.f].label}</strong>
              <small>{fmt(m.at)}</small>
            </li>
          ))}
        </ol>
      </section>

      <form onSubmit={submit} noValidate>
        <div className="sched-list">
          <section className="sched-card">
            <div className="sched-head"><span className="sched-num">01</span><div><h3>Account registration</h3><p>Students can create accounts and receive their voting key until this deadline.</p></div></div>
            <div className="sched-body">
              <DateField field="registrationClosesAt" draft={draft} saved={saved} errors={errors} set={set} />
              {lateRegistration && <p className="sched-note warn"><Icon name="alert" size={15} />Registration closes after voting ends, so accounts created that late can't vote.</p>}
            </div>
          </section>

          <section className="sched-card">
            <div className="sched-head"><span className="sched-num">02</span><div><h3>Voting period</h3><p>Students can cast, change, or remove their votes only inside this window.</p></div></div>
            <div className="sched-body">
              <div className="sched-pair">
                <DateField field="votingOpensAt" draft={draft} saved={saved} errors={errors} set={set} />
                <span className="pair-arrow" aria-hidden="true">→</span>
                <DateField field="votingClosesAt" draft={draft} saved={saved} errors={errors} set={set} min={draft.votingOpensAt} />
              </div>
              {votingWindowOk && <p className="sched-meta">Voting stays open for <strong>{span(toMs(draft.votingClosesAt) - toMs(draft.votingOpensAt))}</strong></p>}
              <p className={`sched-note ${locked ? 'warn' : ''}`}><Icon name="lock" size={15} />{locked
                ? 'Voting has started, so candidate editing is permanently locked. Moving this date will not unlock it.'
                : 'Candidate editing locks permanently the moment voting opens.'}</p>
            </div>
          </section>

          <section className="sched-card">
            <div className="sched-head"><span className="sched-num">03</span><div><h3>Results announcement</h3><p>The top 5 King and Queen finalists are revealed to everyone after this time.</p></div></div>
            <div className="sched-body">
              <DateField field="resultsPublishedAt" draft={draft} saved={saved} errors={errors} set={set} min={draft.votingClosesAt} />
            </div>
          </section>
        </div>

        <div className={`save-bar ${dirty.length ? 'show' : ''}`}>
          <span>{dirty.length ? `${dirty.length} unsaved change${dirty.length > 1 ? 's' : ''}` : 'All changes saved'}</span>
          <div>
            <button type="button" className="button secondary" disabled={!dirty.length || saving} onClick={() => setDraft(saved)}>Discard</button>
            <button type="submit" className="button primary" disabled={!dirty.length || hasErrors || saving}>{saving ? 'Saving…' : 'Save schedule'}</button>
          </div>
        </div>
      </form>
      <p className="footnote">All times are entered and shown in Myanmar Time (UTC+06:30), regardless of your device's time zone. Closing deadlines include their final minute.</p>

      {confirmLock && (
        <div className="overlay center">
          <section role="alertdialog" aria-modal="true" aria-labelledby="lock-title" className="modal small-modal">
            <div className="warning-symbol"><Icon name="lock" size={25} /></div>
            <h2 id="lock-title">Open voting now?</h2>
            <p className="muted">The new opening time is not in the future, so voting starts as soon as you save and candidate editing locks permanently. Moving the date later will not unlock it.</p>
            <div className="drawer-actions">
              <button type="button" className="button secondary" onClick={() => setConfirmLock(false)}>Cancel</button>
              <button type="button" className="button delete" onClick={save}>Open voting &amp; lock</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
