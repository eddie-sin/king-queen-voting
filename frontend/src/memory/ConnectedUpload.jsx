import { FrameOrnaments } from './FrameOrnaments.jsx';
import { useEffect, useRef, useState } from 'react';
import { readStoredSession, writeStoredSession } from '../hooks/useFestival.js';
import { useMyMemories } from './useMyMemories.js';
import { uploadSelectionError } from './upload.js';
import { ReviewEnvelope } from './ReviewEnvelope.jsx';
import { Icon } from './MemoryIcon.jsx';
import { MEMORY_ASSETS as A } from './demo.js';

export default function ConnectedUpload({ api }) {
  const model = useMyMemories(api);
  const [selected, setSelected] = useState([]), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const [outcomes, setOutcomes] = useState([]), [submitted, setSubmitted] = useState([]);
  const [dragging, setDragging] = useState(false);
  const items = useRef([]), running = useRef(false), mounted = useRef(true), operation = useRef(null);
  const files = useRef(null), camera = useRef(null);
  const sessionToken = useRef(readStoredSession()?.token);
  const clear = () => { items.current.forEach(item => URL.revokeObjectURL(item.url)); items.current = []; setSelected([]); };
  useEffect(() => {
    mounted.current = true;
    const checkSession = () => {
      if (readStoredSession()?.token !== sessionToken.current) {
        operation.current?.abort(); clear(); setOutcomes([]); setSubmitted([]); setError('');
        sessionToken.current = readStoredSession()?.token;
      }
    };
    window.addEventListener('festival-session-change', checkSession); window.addEventListener('storage', checkSession); window.addEventListener('focus', checkSession);
    return () => { mounted.current = false; operation.current?.abort(); items.current.forEach(item => URL.revokeObjectURL(item.url)); window.removeEventListener('festival-session-change', checkSession); window.removeEventListener('storage', checkSession); window.removeEventListener('focus', checkSession); };
  }, []);
  useEffect(() => {
    if (['anonymous', 'expired', 'forbidden'].includes(model.phase)) { clear(); setSubmitted([]); }
  }, [model.phase]);
  const ready = model.phase === 'ready', remaining = ready ? model.quota.remainingSlots : 0;
  const selectionLimit = ready ? remaining : 3;
  function addFiles(list) {
    if (running.current) return;
    const next = [...items.current]; let problem = '';
    for (const file of list) {
      const invalid = uploadSelectionError(file, next.length, selectionLimit);
      if (invalid) { problem = invalid; continue; }
      next.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file), blocked: false });
    }
    items.current = next; setSelected(next); setError(problem);
  }
  function remove(id) {
    if (running.current) return;
    const item = items.current.find(item => item.id === id); if (item) URL.revokeObjectURL(item.url);
    items.current = items.current.filter(item => item.id !== id); setSelected(items.current); setError('');
  }
  async function submit() {
    if (running.current || model.phase !== 'ready' || !items.current.length) return;
    const token = readStoredSession()?.token;
    if (!token) { await model.refresh(); return; }
    const batch = items.current.filter(item => !item.blocked);
    if (!batch.length) return;
    running.current = true; setBusy(true); setError(''); setOutcomes([]);
    const controller = new AbortController(); operation.current = controller;
    const current = () => mounted.current && !controller.signal.aborted && readStoredSession()?.token === token;
    try {
      let history = await api.myMemoryPhotos(token, { signal: controller.signal });
      if (!current()) return;
      if (batch.length > history.quota.remainingSlots) { setError('Your allowance has changed. Remove photos to match your remaining slots.'); return; }
      for (let index = 0; index < batch.length; index++) {
        if (!current()) break;
        const item = batch[index];
        if (!history.quota.remainingSlots) { setError('Your lifetime allowance is full. Remaining photos were not sent.'); break; }
        setProgress(`Uploading photo ${index + 1} of ${batch.length}…`);
        try {
          const photo = await api.uploadMemoryPhoto(token, item.file, { signal: controller.signal });
          if (!current()) break;
          setSubmitted(previous => [...previous, photo]);
          setOutcomes(previous => [...previous, { id: item.id, name: item.file.name, message: 'Submitted · Pending review' }]);
          URL.revokeObjectURL(item.url); items.current = items.current.filter(value => value.id !== item.id); setSelected([...items.current]);
        } catch (failure) {
          if (!current()) break;
          const uncertain = failure.interrupted || !failure.status || failure.status >= 500;
          if (uncertain) { item.blocked = true; setSelected([...items.current]); }
          setOutcomes(previous => [...previous, { id: item.id, name: item.file.name, message: uncertain ? 'Confirmation uncertain. Check My Memories before choosing this photo again.' : failure.status === 401 ? 'Session expired. Sign in again.' : failure.status === 403 ? 'Submissions are unavailable.' : failure.status === 409 ? 'Lifetime allowance reached.' : 'Not accepted. Check the image and try again.' }]);
          if (failure.status === 401) { writeStoredSession(null); setError('Your session has expired. Please sign in again.'); break; }
          if (uncertain || [403, 409].includes(failure.status)) break;
        }
        // Refresh after each conclusive result; never derive capacity from cards.
        history = await api.myMemoryPhotos(token, { signal: controller.signal });
      }
    } catch {
      if (current()) setError('Could not confirm your allowance. No further photos were sent. Check My Memories and try refreshing.');
    } finally {
      running.current = false;
      if (mounted.current) { setBusy(false); setProgress(''); await model.refresh(); }
    }
  }
  const messages = { loading: 'Opening your submission allowance…', anonymous: 'Sign in with your student account to share a memory.', expired: 'Your session has expired. Please sign in again.', forbidden: 'An active student account is required.', disabled: 'Memory Photo is currently disabled by the organisers.', error: 'Your allowance could not be loaded. Please try again.' };
  return <div className="mp-upload-layout">
    <section className="mp-upload-story"><p className="mp-eyebrow">A PAGE IN OUR KEEPSAKE</p><h1>Your day.<br/><em>Your little<br/> lights.</em></h1><p>Three photos. A few favourite faces.<br/>A little piece of our Thadingyut.</p><img className="mp-story-lantern" src={A + 'memory-keepsake-lantern.svg'} alt=""/><div className="mp-story-print"><img src={A + 'campus-together.png'} alt="Illustrative college celebration; design artwork"/><span>the good days, kept close.</span></div><p className="mp-small-note">✦ A little care before we share.</p></section>
    <section className="mp-studio" aria-labelledby="mp-studio-title"><div className="mp-studio-top"><span className="mp-eyebrow">✦ COLLECT YOUR MOMENTS</span><span className="mp-counter">{selected.length} / 3 selected</span></div><h2 id="mp-studio-title">A memory worth <em>keeping.</em></h2><p className="mp-muted">Choose a few little pieces of your celebration.</p>
      {!ready && <div className="mp-local-note" role="status"><span>{messages[model.phase]} Local previews stay on this device and cannot be submitted yet.{['anonymous', 'expired', 'forbidden'].includes(model.phase) ? <a href="#account"> Sign in at the festival</a> : model.phase !== 'loading' && <button className="mp-button mp-outline" disabled={busy} onClick={model.refresh}>Try again</button>}</span></div>}
      {ready && <div className="mp-local-note"><Icon name="image"/><span><strong>Your lifetime allowance</strong><span role="status">Limit: {model.quota.limit} · Accepted: {model.quota.acceptedCount} · Remaining: {remaining}</span><br/>Rejected submissions still use a lifetime slot.</span></div>}
      <div className={`mp-drop ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); addFiles([...event.dataTransfer.files]); }}>
        <div className="mp-slots">{[0, 1, 2].map(index => <div className={`mp-slot ${selected[index] ? 'is-filled' : ''}`} key={index}>{selected[index] ? <><img src={selected[index].url} alt={`Selected local photo ${index + 1}`}/><button className="mp-remove" disabled={busy} aria-label={`Remove selected photo ${index + 1}`} onClick={() => remove(selected[index].id)}>×</button><span className="mp-slot-label">Photo {index + 1}{selected[index].blocked ? ' · Check history' : ''}</span></> : <button className="mp-slot-choose" disabled={busy || selected.length >= selectionLimit} onClick={() => files.current.click()} aria-label={`Choose photo for slot ${index + 1}`}><span className="mp-slot-number">0{index + 1}</span><Icon name="plus"/><em>Your {['first', 'second', 'third'][index]}<br/>moment</em></button>}</div>)}</div>
        <p className="mp-drop-hint">Drop photos here, or choose below.</p><div className="mp-file-actions"><button className="mp-button mp-gold" disabled={busy || selected.length >= selectionLimit} onClick={() => files.current.click()}><Icon name="image"/>Choose photos</button><button className="mp-button mp-outline" disabled={busy || selected.length >= selectionLimit} onClick={() => camera.current.click()}><Icon name="camera"/>Take a photo</button></div><p className="mp-file-help">JPG, PNG or WebP · Up to 5 MB each</p>
      </div>
      <input ref={files} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={busy} onChange={event => { addFiles([...event.target.files]); event.target.value = ''; }}/><input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden disabled={busy} onChange={event => { addFiles([...event.target.files]); event.target.value = ''; }}/>
      <p className="mp-error" role="alert">{error}</p><div className="mp-review-explanation"><Icon name="clock"/><p><strong>A little care before we share.</strong>Photos are reviewed before appearing on the wall. Each accepted submission uses one lifetime slot.</p></div>
      <button className="mp-button mp-gold mp-submit" disabled={!ready || busy || !selected.some(item => !item.blocked) || selected.filter(item => !item.blocked).length > remaining} onClick={submit}>{busy ? 'Sending your memories…' : 'Submit memories'} <Icon name="arrow"/></button>
      <div className="mp-preview-result" role="status">{progress}</div>
      {outcomes.length > 0 && <ul className="mp-upload-outcomes" aria-label="Individual upload results">{outcomes.map(outcome => <li key={outcome.id}><strong>{outcome.name}</strong> — {outcome.message}</li>)}</ul>}
      {ready && submitted.length > 0 && <div className="mp-submitted"><p role="status">Your {submitted.length === 1 ? 'memory is' : 'memories are'} awaiting review.</p><div className="mp-my-grid">{submitted.map((photo, index) => <ReviewEnvelope key={photo.id} demo={false} index={index} createdAt={photo.createdAt}/>)}</div></div>}
      <a className="mp-sample-link" href="#my-memories">View My Memories and current allowance →</a><a className="mp-sample-link" href="#memory-upload-demo">Open explicitly labeled demo upload studio</a>
    </section>
  </div>;
}
