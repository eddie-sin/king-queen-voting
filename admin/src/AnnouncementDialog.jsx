import { useEffect, useRef, useState } from 'react';
import { planAwards } from '../../utils/awardSelection.mjs';
import { request, imageSrc } from './api.js';
import { Spinner } from './Loader.jsx';

export default function AnnouncementDialog({ token, busy, onClose, onPublish }) {
  const dialog = useRef(null), [preview, setPreview] = useState(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [mode, setMode] = useState('default'), [picks, setPicks] = useState({}), [step, setStep] = useState(0);
  async function refresh(signal) {
    setLoading(true); setError('');
    try { const data = await request('/admin/announcement-preview', { token, signal }); if (!signal?.aborted) { setPreview(data); setPicks({}); setStep(0); } }
    catch (e) { if (!signal?.aborted) { setPreview(null); setError(e.message); } }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => { dialog.current.showModal(); const controller = new AbortController(); refresh(controller.signal); return () => controller.abort(); }, [token]);
  const plan = planAwards(preview?.entries || [], mode, picks);
  const visible = plan.slots.filter(slot => slot.rank === step);
  const canContinue = preview && visible.every(slot => !slot.invalid && (!slot.required || slot.selected));
  function choose(key, id) {
    setPicks(current => { const next = { ...current }; if (id) next[key] = id; else delete next[key]; if (key === 'king') delete next.mrs; if (key === 'queen') delete next.miss; return next; });
    setError('');
  }
  async function publish() {
    setError('');
    const result = await onPublish({ mode, picks: plan.selection }, preview.revision);
    if (result.ok) onClose();
    else setError(result.message);
  }
  return <dialog ref={dialog} className="modal announcement-dialog" aria-labelledby="announcement-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <p className="eyebrow">KING & QUEEN · ANNOUNCEMENT</p><h2 id="announcement-title">{step === 0 ? 'Choose King & Queen' : step === 1 ? 'Choose the Thadingyut titles' : 'Review your announcement'}</h2>
    <p className="muted">Step {step + 1} of 3 · {step === 2 ? 'These titles and the real vote totals will be visible to students.' : 'Review the recorded votes, then choose who receives each title.'}</p>
    {error && <p className="announcement-error" role="alert">{error}</p>}
    {loading ? <p role="status"><Spinner /> Loading vote results…</p> : !preview ? <button className="button secondary" onClick={() => refresh()}>Reload vote results</button> : <>
      {step === 0 && <fieldset className="announcement-mode" disabled={busy}><legend>How would you like to choose?</legend>
        <label><input type="radio" name="award-mode" checked={mode === 'default'} onChange={() => { setMode('default'); setPicks({}); }} />Go as default<span>Most votes receive King / Queen. Second most receive Mrs / Miss Thadingyut. You choose any ties.</span></label>
        <label><input type="radio" name="award-mode" checked={mode === 'manual'} onChange={() => { setMode('manual'); setPicks({}); }} />Choose manually<span>Give each title to any candidate in its category. Recorded votes stay unchanged.</span></label>
      </fieldset>}
      {step < 2 ? <div className="announcement-selections">{visible.map(slot => <section className="announcement-slot" key={slot.key}>
        <h3>{slot.title}</h3>{!slot.required ? <p className="muted">Not awarded — {slot.rank ? 'no second candidate' : 'no candidates'} in this category.</p> : <>
          <p className="small">{slot.tied ? 'Tied on votes. Choose one to continue.' : mode === 'default' ? 'Selected by recorded vote rank.' : 'Choose a title holder below.'}</p>
          <label className="field"><span>{slot.title} title holder</span><select aria-label={`${slot.title} title holder`} value={slot.selected ? String(slot.selected.candidate._id) : ''} disabled={busy} onChange={e => choose(slot.key, e.target.value)}>
            <option value="">Choose a candidate…</option>{slot.options.map(row => <option key={row.candidate._id} value={row.candidate._id}>{row.candidate.fullName} · {row.votes} {row.votes === 1 ? 'vote' : 'votes'}{row.candidate.isActive ? '' : ' · inactive'}</option>)}
          </select></label>
          {slot.selected?.candidate.images?.[0] && <img className="announcement-portrait" src={imageSrc(slot.selected.candidate.images[0])} alt={slot.selected.candidate.fullName} />}
        </>}
      </section>)}</div> : <div className="announcement-review">{plan.slots.map(slot => <div key={slot.key}><span>{slot.title}</span><strong>{slot.selected?.candidate.fullName || 'Not awarded'}</strong>{slot.selected && <small>{slot.selected.votes} {slot.selected.votes === 1 ? 'vote' : 'votes'}</small>}</div>)}<p className="small">To change the title holders later, close the announcement and announce again.</p></div>}
      {step < 2 && <details className="announcement-totals"><summary>View all recorded vote results</summary>{['king', 'queen'].map(category => <div key={category}><h3>{category === 'king' ? 'King category' : 'Queen category'}</h3><ol>{preview.entries.filter(row => row.candidate.category === category).map(row => <li key={row.candidate._id}><span>{row.candidate.fullName}{row.candidate.isActive ? '' : ' (inactive)'}</span><strong>{row.votes} votes</strong></li>)}</ol></div>)}</details>}
    </>}
    <div className="drawer-actions"><button className="button secondary" disabled={busy} onClick={onClose}>Cancel</button>{preview && !loading && <>
      {step > 0 && <button className="button secondary" disabled={busy} onClick={() => { setStep(step - 1); setError(''); }}>Back</button>}
      {step < 2 ? <button className="button" disabled={busy || !canContinue} onClick={() => setStep(step + 1)}>{step === 0 ? 'Next: Thadingyut titles' : 'Review announcement'}</button> : <button className="button" disabled={busy || !plan.ready} onClick={publish}>{busy ? <><Spinner size={14} />Publishing…</> : 'Publish announcement'}</button>}
    </>}</div>
    {error && preview && !busy && <button className="text-button" onClick={() => refresh()}>Reload results and choose again</button>}
  </dialog>;
}
