import { FrameOrnaments } from './FrameOrnaments.jsx';
import { useEffect, useState } from 'react';
import { Dialog } from '../components/Dialog.jsx';
import { ReviewEnvelope } from './ReviewEnvelope.jsx';
import { useMyMemories } from './useMyMemories.js';
import { readStoredSession } from '../hooks/useFestival.js';

const dateLabel = value => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Yangon' });
function ApprovedMemory({ photo, index, imageUrl, retryKey, onView, onRefresh, onArchive, onDelete }) {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => setUnavailable(false), [retryKey, imageUrl]);
  return <article className="mp-print mp-opened" style={{ '--tilt': `${index % 2 ? 2 : -2}deg` }}>
    <div className="mp-folio"><span>GUSTO / THADINGYUT</span><span>{String(index + 1).padStart(2, '0')}</span></div>
    {unavailable ? <div className="mp-image-unavailable"><p>This photo could not be loaded.</p><button className="mp-button mp-outline" onClick={onRefresh}>Refresh memories</button></div> :
      <button className="mp-photo-open" onClick={() => onView(photo)} aria-label={`Enlarge approved memory ${index + 1}`}><img src={imageUrl} alt={`Your approved Memory Photo, submitted ${dateLabel(photo.createdAt)}`} loading="lazy" width="1200" height="900" onError={() => setUnavailable(true)}/><span className="mp-photo-overlay">A closer look +</span></button>}
    <div className="mp-print-bottom"><div><time className="mp-date" dateTime={photo.createdAt}>{dateLabel(photo.createdAt)}</time><span className="mp-status mp-approved">Approved · opened & shared</span><div className="mp-card-actions"><button className="mp-button mp-outline" onClick={onArchive}>Archive</button><button className="mp-button mp-outline" onClick={onDelete}>Delete</button></div></div></div>
  </article>;
}
function ArchivedMemory({ photo, index, api, token, onView, onUnarchive, onDelete }) {
  const [src, setSrc] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let url = '';
    api.memoryPhotoOwnerImage(token, photo.id, { signal: controller.signal }).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setSrc(url);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [api, token, photo.id]);
  return <article className="mp-print mp-opened mp-archived-card" style={{ '--tilt': `${index % 2 ? 2 : -2}deg` }}>
    <div className="mp-folio"><span>GUSTO / THADINGYUT</span><span>ARCHIVED</span></div>
    {src ? <button className="mp-photo-open" onClick={() => onView(photo)} aria-label="View archived memory"><img src={src} alt={`Your archived Memory Photo, submitted ${dateLabel(photo.createdAt)}`} loading="lazy"/></button> : <div className="mp-image-unavailable"><p>{error || 'Opening your private memory…'}</p></div>}
    <div className="mp-print-bottom mp-archive-actions"><span className="mp-status mp-archived-status">Archived · private</span><button className="mp-button mp-outline" onClick={onUnarchive}>Unarchive</button><button className="mp-button mp-outline" onClick={onDelete}>Delete</button></div>
  </article>;
}

const messages = {
  anonymous: ['A little place of your own.', 'Sign in with your student account to see your submissions. Your submissions are saved to your account.'],
  loading: ['Opening your keepsake…', 'Gathering your photos and current submission allowance.'],
  expired: ['A fresh hello.', 'Your session has expired. Please sign in again to view your memories.'],
  forbidden: ['Student access is unavailable.', 'This account cannot view student submissions. Try an active student account.'],
  disabled: ['Our keepsake is resting.', 'Memory Photo is currently disabled by the organisers. Your submissions are not displayed while it is closed.'],
  error: ['Your memories need a moment.', 'We couldn’t reach your memories. Check your connection and try again.'],
};

export default function MyMemories({ api }) {
  const model = useMyMemories(api);
  const [viewer, setViewer] = useState(null);
  const [viewerError, setViewerError] = useState(false);
  const [confirm, setConfirm] = useState(null), [notice, setNotice] = useState(''), [actionBusy, setActionBusy] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const refreshImages = () => { setImageAttempt(value => value + 1); model.refresh(); };
  useEffect(() => {
    setViewer(previous => {
      const current = previous && model.photos.find(photo => photo.id === previous.id);
      return model.phase === 'ready' && current && current.status === previous.status ? previous : null;
    });
    if (model.phase !== 'ready') setConfirm(null);
  }, [model.phase, model.photos]);
  const message = messages[model.phase];
  return <section className="mp-my-page" aria-labelledby="mp-my-title">
    <div className="mp-my-heading"><p className="mp-eyebrow">YOUR LITTLE COLLECTION</p><h1 id="mp-my-title">Some moments.<br/><em>Just yours.</em></h1><p>Opened, sealed, or kept close. A little care goes into every memory.</p></div>
    {message ? <div className="mp-mine-state" role={['error', 'expired', 'forbidden'].includes(model.phase) ? 'alert' : 'status'}><span aria-hidden="true">✦</span><h2>{message[0]}</h2><p>{message[1]}</p>
      {['anonymous', 'expired', 'forbidden'].includes(model.phase) && <a className="mp-button mp-gold" href="#account">Sign in at the festival</a>}
      {['error', 'disabled'].includes(model.phase) && <button className="mp-button mp-outline" onClick={model.refresh}>Try again</button>}
      {model.phase !== 'loading' && <a className="mp-sample-link" href="#my-memories-demo">View explicitly labeled sample states</a>}
    </div> : <>
      <dl className="mp-quota" aria-label="Your active submission allowance"><div><dt>Active limit</dt><dd>{model.quota.limit}</dd></div><div><dt>Active photos</dt><dd>{model.quota.acceptedCount}</dd></div><div><dt>Remaining slots</dt><dd>{model.quota.remainingSlots}</dd></div></dl>
      <p className="mp-small-note">Pending and approved photos occupy slots. Rejected and permanently deleted photos release one.</p>
      {!model.photos.length ? <div className="mp-mine-state" role="status"><span aria-hidden="true">✦</span><h2>A blank page, full of possibility.</h2><p>No submissions are recorded for your account yet.</p></div> :
        <div className="mp-my-grid">{model.photos.map((photo, index) => photo.status === 'APPROVED'
          ? <ApprovedMemory key={photo.id} photo={photo} index={index} imageUrl={api.memoryPhotoImageUrl(photo.id)} retryKey={imageAttempt} onRefresh={refreshImages} onArchive={() => setConfirm({ kind: 'archive', photo })} onDelete={() => setConfirm({ kind: 'delete', photo })} onView={photo => { setViewerError(false); setViewer(photo); }}/>
          : photo.status === 'PENDING' || photo.status === 'REJECTED'
            ? <ReviewEnvelope key={photo.id} rejected={photo.status === 'REJECTED'} demo={false} index={index} createdAt={photo.createdAt}/>
            : photo.status === 'ARCHIVED' ? <ArchivedMemory key={photo.id} photo={photo} index={index} api={api} token={readStoredSession()?.token} onView={photo => { setViewerError(false); setViewer(photo); }} onUnarchive={() => setConfirm({ kind: 'unarchive', photo })} onDelete={() => setConfirm({ kind: 'delete', photo })}/> : <article key={photo.id} className="mp-mine-state mp-status-card"><span aria-hidden="true">✦</span><h3>Deleted memory</h3><p>The image has been permanently removed.</p></article>)}</div>}
      <div className="mp-mine-actions"><button className="mp-button mp-outline" onClick={refreshImages}>Refresh my memories</button><a className="mp-sample-link" href="#my-memories-demo">View sample design</a></div>
    </>}
    {viewer && model.phase === 'ready' && <Dialog title="A little closer." className="mp-viewer" onClose={() => setViewer(null)}>{viewerError ? <div role="alert"><p>This photo could not be loaded.</p><button className="mp-button mp-outline" onClick={() => setViewerError(false)}>Try loading photo again</button></div> : <img src={viewer.status === 'ARCHIVED' ? api.memoryPhotoOwnerImageUrl(viewer.id) : api.memoryPhotoImageUrl(viewer.id)} alt={`Your ${viewer.status === 'ARCHIVED' ? 'archived' : 'approved'} Memory Photo from ${dateLabel(viewer.createdAt)}`} onError={() => setViewerError(true)}/>}<div className="mp-viewer-bottom"><time dateTime={viewer.createdAt}>{dateLabel(viewer.createdAt)}</time><span>{viewer.status === 'ARCHIVED' ? 'Archived · private' : 'Approved Memory Photo'}</span></div></Dialog>}
    {notice && <p className="mp-like-notice" role="status">{notice}</p>}
    {confirm && <Dialog className="mp-confirm-dialog" title={`${confirm.kind === 'delete' ? 'Permanently delete' : confirm.kind === 'archive' ? 'Archive' : 'Unarchive'} this memory?`} onClose={() => !actionBusy && setConfirm(null)} locked={actionBusy}><div className="mp-confirm-ornament" aria-hidden="true">✦</div><p className="mp-confirm-copy">{confirm.kind === 'archive' ? 'It will leave the public gallery but keep one active slot.' : confirm.kind === 'unarchive' ? 'It will return to the public gallery without using another slot.' : 'The private image will be deleted and this cannot be undone.'}</p><div className="mp-dialog-actions"><button className="mp-button mp-outline" disabled={actionBusy} onClick={() => setConfirm(null)}>Cancel</button><button className={`mp-button ${confirm.kind === 'delete' ? 'mp-danger' : 'mp-gold'}`} disabled={actionBusy} onClick={async () => { setActionBusy(true); try { await model[confirm.kind === 'delete' ? 'remove' : confirm.kind](confirm.photo.id); setNotice(confirm.kind === 'delete' ? 'Memory permanently deleted.' : confirm.kind === 'archive' ? 'Memory archived privately.' : 'Memory restored to the public gallery.'); setConfirm(null); } catch (error) { setNotice(error.message); } finally { setActionBusy(false); } }}>{actionBusy ? 'Saving…' : confirm.kind === 'delete' ? 'Delete permanently' : confirm.kind === 'archive' ? 'Archive memory' : 'Unarchive memory'}</button></div></Dialog>}
  </section>;
}
