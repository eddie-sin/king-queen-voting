import { FrameOrnaments } from './FrameOrnaments.jsx';
import { useEffect, useState } from 'react';
import { Dialog } from '../components/Dialog.jsx';
import { ReviewEnvelope } from './ReviewEnvelope.jsx';
import { useMyMemories } from './useMyMemories.js';

const dateLabel = value => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Yangon' });
function ApprovedMemory({ photo, index, imageUrl, onView, onRefresh }) {
  const [unavailable, setUnavailable] = useState(false);
  return <article className="mp-print mp-opened" style={{ '--tilt': `${index % 2 ? 2 : -2}deg` }}>
    <div className="mp-folio"><span>GUSTO / THADINGYUT</span><span>{String(index + 1).padStart(2, '0')}</span></div>
    {unavailable ? <div className="mp-image-unavailable"><p>This image needs a moment.</p><button className="mp-button mp-outline" onClick={onRefresh}>Refresh memories</button></div> :
      <button className="mp-photo-open" onClick={() => onView(photo)} aria-label={`Enlarge approved memory ${index + 1}`}><img src={imageUrl} alt={`Your approved Memory Photo, submitted ${dateLabel(photo.createdAt)}`} loading="lazy" width="1200" height="900" onError={() => setUnavailable(true)}/><span className="mp-photo-overlay">A closer look +</span></button>}
    <div className="mp-print-bottom"><div><time className="mp-date" dateTime={photo.createdAt}>{dateLabel(photo.createdAt)}</time><span className="mp-status mp-approved">Approved · opened & shared</span></div></div>
  </article>;
}

const messages = {
  anonymous: ['A little place of your own.', 'Sign in with your student account to see your submissions. Your voting key is not needed.'],
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
  useEffect(() => { if (model.phase !== 'ready') setViewer(null); }, [model.phase]);
  const message = messages[model.phase];
  return <section className="mp-my-page" aria-labelledby="mp-my-title">
    <div className="mp-my-heading"><p className="mp-eyebrow">YOUR LITTLE COLLECTION</p><h1 id="mp-my-title">Some moments.<br/><em>Just yours.</em></h1><p>Opened, sealed, or kept close. A little care goes into every memory.</p></div>
    {message ? <div className="mp-mine-state" role={['error', 'expired', 'forbidden'].includes(model.phase) ? 'alert' : 'status'}><span aria-hidden="true">✦</span><h2>{message[0]}</h2><p>{message[1]}</p>
      {['anonymous', 'expired', 'forbidden'].includes(model.phase) && <a className="mp-button mp-gold" href="#account">Sign in at the festival</a>}
      {['error', 'disabled'].includes(model.phase) && <button className="mp-button mp-outline" onClick={model.refresh}>Try again</button>}
      {model.phase !== 'loading' && <a className="mp-sample-link" href="#my-memories-demo">View explicitly labeled sample states</a>}
    </div> : <>
      <dl className="mp-quota" aria-label="Your backend submission allowance"><div><dt>Lifetime limit</dt><dd>{model.quota.limit}</dd></div><div><dt>Accepted submissions</dt><dd>{model.quota.acceptedCount}</dd></div><div><dt>Remaining slots</dt><dd>{model.quota.remainingSlots}</dd></div></dl>
      <p className="mp-small-note">Pending, approved and rejected submissions count toward your lifetime allowance.</p>
      {!model.photos.length ? <div className="mp-mine-state" role="status"><span aria-hidden="true">✦</span><h2>A blank page, full of possibility.</h2><p>No submissions are recorded for your account yet.</p></div> :
        <div className="mp-my-grid">{model.photos.map((photo, index) => photo.status === 'APPROVED'
          ? <ApprovedMemory key={photo.id} photo={photo} index={index} imageUrl={api.memoryPhotoImageUrl(photo.id)} onRefresh={model.refresh} onView={photo => { setViewerError(false); setViewer(photo); }}/>
          : <ReviewEnvelope key={photo.id} rejected={photo.status === 'REJECTED'} demo={false} index={index} createdAt={photo.createdAt}/>)}</div>}
      <div className="mp-mine-actions"><button className="mp-button mp-outline" onClick={model.refresh}>Refresh my memories</button><a className="mp-sample-link" href="#my-memories-demo">View sample design</a></div>
    </>}
    {viewer && model.phase === 'ready' && <Dialog title="A little closer." className="mp-viewer" onClose={() => setViewer(null)}>{viewerError ? <p role="alert">The image is unavailable. Close this view and refresh your memories.</p> : <img src={api.memoryPhotoImageUrl(viewer.id)} alt={`Your approved Memory Photo from ${dateLabel(viewer.createdAt)}`} onError={() => setViewerError(true)}/>}<div className="mp-viewer-bottom"><time dateTime={viewer.createdAt}>{dateLabel(viewer.createdAt)}</time><span>Approved Memory Photo</span></div></Dialog>}
  </section>;
}
