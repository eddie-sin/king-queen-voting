import { FrameOrnaments } from './FrameOrnaments.jsx';
import { useMemoryLikes } from './useMemoryLikes.js';
import { Icon } from './MemoryIcon.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog.jsx';
import { MEMORY_ASSETS as A } from './demo.js';

const dateLabel = value => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Yangon' });
function GalleryCard({ photo, index, api, onView, refresh, hearts, onRequireLogin }) {
  const [failed, setFailed] = useState(false);
  return <article className="mp-print" style={{ '--tilt': `${index % 2 ? 2 : -2}deg`, '--delay': `${Math.min(index, 5) * 90}ms` }}>
    <div className="mp-folio"><span>GUSTO / THADINGYUT</span><span>{String(index + 1).padStart(2, '0')}</span></div>
    {failed ? <div className="mp-image-unavailable"><p>This image needs a moment.</p><button className="mp-button mp-outline" onClick={refresh}>Refresh gallery</button></div> : <button className="mp-photo-open" onClick={() => onView(photo)} aria-label={`Enlarge memory ${index + 1}`}><img src={api.memoryPhotoImageUrl(photo.id)} alt={`Festival memory from ${dateLabel(photo.createdAt)}`} width="1200" height="900" loading="lazy" onError={() => setFailed(true)}/><span className="mp-photo-overlay">A closer look +</span></button>}
    <div className="mp-print-bottom"><time className="mp-date" dateTime={photo.createdAt}>{dateLabel(photo.createdAt)}</time><Heart photo={photo} hearts={hearts} onRequireLogin={onRequireLogin}/></div>
  </article>;
}

function Heart({ photo, hearts, onRequireLogin }) {
  const entry = hearts.entries[photo.id];
  const known = typeof entry?.liked === 'boolean';
  return <button className={`mp-heart mp-live-heart ${known && entry.liked ? 'is-liked' : ''} ${entry?.pop ? 'mp-heart-pop' : ''}`} aria-label={hearts.anonymous ? `Sign in to like memory · ${photo.likeCount} likes` : known ? `${entry.liked ? 'Unlike' : 'Like'} memory · ${photo.likeCount} likes` : `Heart status unavailable · ${photo.likeCount} likes`} aria-pressed={known ? entry.liked : undefined} disabled={!hearts.anonymous && (!known || entry.busy)} onClick={() => hearts.anonymous ? onRequireLogin() : hearts.toggle(photo.id)}><Icon name="heart"/><span>{photo.likeCount}</span></button>;
}

export default function AllMemories({ api, onRequireLogin }) {
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [state, setState] = useState({ phase: 'loading', photos: [] });
  const [viewer, setViewer] = useState(null), [imageError, setImageError] = useState(false);
  const serial = useRef(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController(), generation = ++serial.current;
    setViewer(null); setState({ phase: 'loading', photos: [] });
    api.memoryPhotos(page, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted && generation === serial.current) setState({ phase: 'ready', ...data });
    }).catch(error => {
      if (!controller.signal.aborted && generation === serial.current) setState({ phase: error.status === 403 ? 'disabled' : 'error', photos: [] });
    });
    return () => { controller.abort(); serial.current++; };
  }, [api, page, revision]);
  useEffect(() => {
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [refresh]);
  const updateLike = useCallback(result => {
    setState(previous => ({ ...previous, photos: previous.photos.map(photo => photo.id === result.photoId ? { ...photo, likeCount: result.likeCount } : photo) }));
  }, []);
  const hearts = useMemoryLikes(api, state.phase === 'ready' ? state.photos.map(photo => photo.id) : [], updateLike, refresh);
  const shownViewer = viewer && (state.photos.find(photo => photo.id === viewer.id) || viewer);
  const messages = {
    loading: ['Gathering our little lights…', 'Opening the festival keepsake.'],
    disabled: ['Our keepsake is resting.', 'Memory Photo is currently disabled by the organisers.'],
    error: ['Our memories need a moment.', 'The gallery could not be loaded. Please try again.'],
  };
  const message = messages[state.phase];
  return <>
    <section className="mp-hero"><div className="mp-hero-copy"><p className="mp-eyebrow">✦ GUSTO COLLEGE · THADINGYUT 2026</p><h1>Our day,<br/>in <em>lights.</em></h1><p className="mp-lead">Little moments.<br/>Beautifully remembered.</p><a className="mp-button mp-gold" href="#memory-upload">Share your memory</a><span className="mp-signature">a little light, a little us ↗</span></div><div className="mp-hero-art mp-live-art"><img src={A + 'memory-keepsake-lantern.svg'} alt=""/><div className="mp-seal" aria-hidden="true"><span>GUSTO COLLEGE</span><b>Made of<br/><em>memories.</em></b><small>✦ 2026 ✦</small></div></div></section>
    <section className="mp-wall" aria-labelledby="mp-wall-title" aria-busy={state.phase === 'loading'}><div className="mp-section-heading"><div><p className="mp-eyebrow">THE COLLEGE KEEPSAKE</p><h2 id="mp-wall-title">Through <em>our eyes.</em></h2></div><span className="mp-album-mark">Our people. Our little traditions.<small>GUSTO · 2026</small></span></div>
      {message ? <div className="mp-mine-state" role={state.phase === 'error' ? 'alert' : 'status'}><h3>{message[0]}</h3><p>{message[1]}</p>{state.phase !== 'loading' && <button className="mp-button mp-outline" onClick={refresh}>Try again</button>}</div> : <>
        {state.photos.length ? <div className="mp-grid">{state.photos.map((photo, index) => <GalleryCard key={`${revision}-${page}-${photo.id}`} photo={photo} index={index} api={api} refresh={refresh} hearts={hearts} onRequireLogin={onRequireLogin} onView={photo => { setImageError(false); setViewer(photo); }}/>)}</div> : <div className="mp-mine-state" role="status"><h3>{page === 1 ? 'The first light is still to come.' : 'No more memories on this page.'}</h3><p>Approved festival photos will appear here.</p></div>}
        <nav className="mp-pagination" aria-label="Gallery pagination"><button className="mp-button mp-outline" disabled={state.pagination.page === 1} onClick={() => setPage(state.pagination.page - 1)}>Previous</button><span role="status">Page {state.pagination.page}</span><button className="mp-button mp-outline" disabled={!state.pagination.hasMore} onClick={() => setPage(state.pagination.page + 1)}>Next</button></nav>
        <div className="mp-mine-actions"><button className="mp-button mp-outline" onClick={refresh}>Refresh gallery</button></div>
      </>}
      {hearts.notice && <div className="mp-like-notice" role="status"><p>{hearts.notice}</p>{!hearts.anonymous && <button className="mp-button mp-outline" onClick={hearts.retry}>Retry heart states</button>}</div>}
      <a className="mp-sample-link" href="#memory-gallery-demo">View explicitly labeled demo gallery</a>
    </section>
    {viewer && state.phase === 'ready' && <Dialog title="A little closer." className="mp-viewer" onClose={() => setViewer(null)}>{imageError ? <p role="alert">This image is unavailable. Close this view and refresh the gallery.</p> : <img src={api.memoryPhotoImageUrl(viewer.id)} alt={`Festival memory from ${dateLabel(viewer.createdAt)}`} onError={() => setImageError(true)}/>}<div className="mp-viewer-bottom"><time dateTime={viewer.createdAt}>{dateLabel(viewer.createdAt)}</time><Heart photo={shownViewer} hearts={hearts} onRequireLogin={onRequireLogin}/></div></Dialog>}
  </>;
}
