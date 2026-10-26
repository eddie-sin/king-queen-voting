import { FrameOrnaments } from './FrameOrnaments.jsx';
import { FestivalMotion } from './FestivalMotion.jsx';
import { Icon } from './MemoryIcon.jsx';
import ConnectedUpload from './ConnectedUpload.jsx';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog.jsx';
import AllMemories from './AllMemories.jsx';
import MyMemories from './MyMemories.jsx';
import { ReviewEnvelope } from './ReviewEnvelope.jsx';
import { DEMO_PHOTOS, MEMORY_ASSETS as A, MEMORY_TABS, selectionError } from './demo.js';
import './memory.css';


function PhotoCard({ photo, index, liked, onLike, onView, personal = false }) {
  return <article className={`mp-print ${personal ? 'mp-opened' : ''}`} style={{ '--tilt': `${index % 2 ? 2 : -2}deg`, '--delay': `${index * 90}ms` }}>
    <div className="mp-folio"><span>GUSTO / THADINGYUT</span><span>0{index + 1}</span></div>
    <button className="mp-photo-open" onClick={() => onView(photo)} aria-label={`Enlarge demo photo ${index + 1}`}>
      <img src={A + photo.image} alt={photo.alt} loading="lazy" width="1200" height="900"/>
      <span className="mp-photo-overlay">A closer look <Icon name="plus"/></span><span className="mp-demo-chip">Demo photograph</span>
    </button>
    <div className="mp-print-bottom"><div><span className="mp-date">{photo.date}</span>{personal && <span className="mp-status mp-approved">Approved · opened & shared</span>}</div>
      <button className={`mp-heart ${liked ? 'is-liked' : ''}`} aria-label={`${liked ? 'Unlike' : 'Like'} demo photo ${index + 1}`} aria-pressed={liked} onClick={() => onLike(photo.id)}><Icon name="heart"/><span>{photo.likes + (liked ? 1 : 0)}</span></button>
    </div>
  </article>;
}


function UploadStudio() {
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [previewed, setPreviewed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const selectedRef = useRef([]);
  const files = useRef(null), camera = useRef(null);
  useEffect(() => () => selectedRef.current.forEach(photo => URL.revokeObjectURL(photo.url)), []);
  function addFiles(list) {
    const next = [...selectedRef.current]; let problem = '';
    for (const file of list) {
      const invalid = selectionError(file, next.length);
      if (invalid) { problem = invalid; continue; }
      next.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
    }
    selectedRef.current = next; setSelected(next); setError(problem); setPreviewed(false);
  }
  function remove(id) {
    const photo = selectedRef.current.find(item => item.id === id);
    if (photo) URL.revokeObjectURL(photo.url);
    selectedRef.current = selectedRef.current.filter(item => item.id !== id);
    setSelected(selectedRef.current); setError(''); setPreviewed(false);
  }
  return <div className="mp-upload-layout">
    <section className="mp-upload-story"><p className="mp-eyebrow">A PAGE IN OUR KEEPSAKE</p><h1>Your day.<br/><em>Your little<br/>{' '}lights.</em></h1><p>Three photos. A few favourite faces.<br/>A little piece of our Thadingyut.</p><img className="mp-story-lantern" src={A + 'memory-keepsake-lantern.svg'} alt=""/>
      <div className="mp-story-print"><img src={A + 'campus-together.png'} alt="Illustrative college celebration; demo content"/><span>the good days, kept close.</span></div><p className="mp-small-note">✦ A local design preview. Nothing is uploaded.</p></section>
    <section className="mp-studio" aria-labelledby="mp-studio-title"><div className="mp-studio-top"><span className="mp-eyebrow">✦ COLLECT YOUR MOMENTS</span><span className="mp-counter">{selected.length} / 3 selected</span></div><h2 id="mp-studio-title">A memory worth <em>keeping.</em></h2><p className="mp-muted">Choose a few little pieces of your celebration.</p>
      <div className="mp-local-note"><Icon name="image"/><span><strong>Make yourself at home.</strong>This is a local preview. No sign-in, uploads or account changes.</span></div>
      <div className={`mp-drop ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); addFiles([...event.dataTransfer.files]); }}>
        <div className="mp-slots">{[0, 1, 2].map(index => <div className={`mp-slot ${selected[index] ? 'is-filled' : ''}`} key={index}>{selected[index] ? <><img src={selected[index].url} alt={`Selected local photo ${index + 1}`}/><button className="mp-remove" aria-label={`Remove selected photo ${index + 1}`} onClick={() => remove(selected[index].id)}>×</button><span className="mp-slot-label">Photo {index + 1}</span></> : <button className="mp-slot-choose" onClick={() => files.current.click()} aria-label={`Choose photo for slot ${index + 1}`}><span className="mp-slot-number">0{index + 1}</span><Icon name="plus"/><em>Your {['first', 'second', 'third'][index]}<br/>moment</em></button>}</div>)}</div>
        <p className="mp-drop-hint">Drop photos here, or choose below.</p><div className="mp-file-actions"><button className="mp-button mp-gold" onClick={() => files.current.click()}><Icon name="image"/>Choose from gallery</button><button className="mp-button mp-outline" onClick={() => camera.current.click()} title="On supported phones, opens the rear camera. Desktop browsers may show a file chooser."><Icon name="camera"/>Take a photo</button></div><p className="mp-file-help">JPG, PNG or WebP · Up to 5 MB each</p>
      </div>
      <input ref={files} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={event => { addFiles([...event.target.files]); event.target.value = ''; }}/><input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={event => { addFiles([...event.target.files]); event.target.value = ''; }}/>
      <p className="mp-error" role="alert">{error}</p><div className="mp-review-explanation"><Icon name="clock"/><p><strong>A little care before we share.</strong>In the live experience, photos are reviewed before appearing on the wall. Three active photos may be pending or approved at one time; rejected photos release their slot.</p></div>
      <button className="mp-button mp-gold mp-submit" disabled={!selected.length} onClick={() => setPreviewed(true)}>Preview submission <Icon name="arrow"/></button>
      <div className="mp-preview-result" role="status">{previewed && <>✦ Your {selected.length === 1 ? 'photo is' : 'photos are'} ready in this preview. Nothing was sent. <a href="#my-memories-demo">Explore sample review states →</a></>}</div>
    </section>
  </div>;
}

export default function MemoryPhotoDemo({ tab, api, demo = false, onRequireLogin }) {
  const [liked, setLiked] = useState(new Set());
  const [viewer, setViewer] = useState(null);
  const main = useRef(null);
  const shell = useRef(null);
  const liveUpload = tab === 'upload' && !demo;
  const liveAll = tab === 'all' && !demo;
  const liveMine = tab === 'mine' && !demo;
  useEffect(() => { setViewer(null); window.scrollTo(0, 0); main.current?.focus({ preventScroll: true }); }, [tab, demo]);
  useEffect(() => {
    const header = document.querySelector('.memory-site-header');
    const update = () => shell.current?.style.setProperty('--memory-header-height', `${header?.getBoundingClientRect().height || 0}px`);
    update();
    const observer = header && 'ResizeObserver' in window ? new ResizeObserver(update) : null;
    observer?.observe(header); window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const toggleLike = id => setLiked(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <div className="mp-demo" ref={shell}>
    <FestivalMotion key={`${tab}-${demo}`}/>
    <a className="mp-skip" href="#mp-content" onClick={event => { event.preventDefault(); main.current.focus(); }}>Skip to memories</a>
    <div className="mp-sparkles" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <span key={index} style={{ '--i': index }}>✦</span>)}</div>

    <main className="mp-main" id="mp-content" ref={main} tabIndex="-1">
      <div className="mp-topline"><a className="mp-wordmark" href="#memory-gallery"><span>✦</span> Memory Photo</a><nav className="mp-tabs" aria-label="Memory Photo pages">{MEMORY_TABS.map(item => <a href={demo && item.id === 'upload' ? '#memory-upload-demo' : demo && item.id === 'all' ? '#memory-gallery-demo' : item.id === 'mine' && demo ? '#my-memories-demo' : item.hash} key={item.id} aria-current={tab === item.id ? 'page' : undefined}>{item.label}</a>)}</nav></div>
      <div className="mp-demo-note"><span className="mp-live-dot"/>{liveAll ? 'THE COLLEGE KEEPSAKE' : liveMine ? 'YOUR MEMORIES' : liveUpload ? 'YOUR LITTLE LIGHTS' : 'DESIGN PREVIEW'}<span>{liveAll ? 'Approved memories from our festival' : liveMine ? 'Your private submission history · only approved photos are public' : liveUpload ? 'Student submissions · reviewed before sharing' : 'Local demo photographs & interactions · no real uploads'}</span></div>
      {liveAll ? <AllMemories api={api} onRequireLogin={onRequireLogin}/> : tab === 'all' ? <>
        <section className="mp-hero"><div className="mp-hero-copy"><p className="mp-eyebrow">✦ GUSTO COLLEGE · THADINGYUT 2026</p><h1>Our day,<br/>in <em>lights.</em></h1><p className="mp-lead">Little moments.<br/>Beautifully remembered.</p><a className="mp-button mp-gold" href="#memory-upload-demo"><Icon name="camera"/>Share your memory</a><span className="mp-signature">a little light, a little us ↗</span></div>
          <div className="mp-hero-art"><div className="mp-arch"><img src={A + 'campus-lanterns.png'} alt="Illustrative students preparing paper lanterns; demo photograph" width="1672" height="941"/></div><div className="mp-seal" aria-hidden="true"><span>GUSTO COLLEGE</span><b>Made of<br/><em>memories.</em></b><small>✦ 2026 ✦</small></div><span className="mp-arch-caption" aria-hidden="true">a day to keep.</span><span className="mp-photo-credit">Illustrative campus photography</span></div>
          <img className="mp-hanging-lantern" src={A + 'memory-keepsake-lantern.svg'} alt=""/>
        </section>
        <section className="mp-wall" aria-labelledby="mp-wall-title"><div className="mp-section-heading"><div><p className="mp-eyebrow">THE COLLEGE KEEPSAKE</p><h2 id="mp-wall-title">Through <em>our eyes.</em></h2></div><span className="mp-album-mark">Our people. Our little traditions.<small>GUSTO · 2026</small></span></div>
          <div className="mp-grid">{DEMO_PHOTOS.slice(0, 2).map((photo, index) => <PhotoCard key={photo.id} photo={photo} index={index} liked={liked.has(photo.id)} onLike={toggleLike} onView={setViewer}/>)}
            <aside className="mp-invitation"><img src={A + 'memory-keepsake-lantern.svg'} alt=""/><div><p className="mp-eyebrow">LEAVE A LITTLE LIGHT</p><h3>One day.<br/><em>So much to keep.</em></h3><a href="#memory-upload-demo">Add your memory <Icon name="arrow"/></a><small>From our college, with love.</small></div></aside>
            <PhotoCard photo={DEMO_PHOTOS[2]} index={2} liked={liked.has(DEMO_PHOTOS[2].id)} onLike={toggleLike} onView={setViewer}/>
          </div></section>
      </> : liveMine ? <MyMemories api={api}/> : tab === 'mine' ? <section className="mp-my-page" aria-labelledby="mp-my-title"><div className="mp-my-heading"><p className="mp-eyebrow">YOUR LITTLE COLLECTION · SAMPLE REVIEW STATES</p><h1 id="mp-my-title">Some moments.<br/><em>Just yours.</em></h1><p>Opened, sealed, or kept close. A little care goes into every memory.</p></div><div className="mp-my-grid"><PhotoCard photo={DEMO_PHOTOS[0]} index={0} liked={liked.has('demo-1')} onLike={toggleLike} onView={setViewer} personal/><ReviewEnvelope/><ReviewEnvelope rejected/></div><p className="mp-small-note">These three examples demonstrate review states, not your real account or submission history. <a href="#my-memories">View my real submissions →</a></p></section> : liveUpload ? <ConnectedUpload api={api}/> : <UploadStudio/>}
      <div className="mp-endmark" aria-hidden="true"><span/>✦ <em>the moments make us</em> ✦<span/></div>
    </main>
    <footer className="mp-footer"><span>GUSTO College · Thadingyut 2026</span><span>Made of light. Made of us.</span><small>{liveAll ? 'Approved festival memories · Original design & artwork preserved' : liveMine ? 'Student submission history · Original design & artwork preserved' : liveUpload ? 'Student submissions · Original design & artwork preserved' : 'Demo content only · Original design & artwork preserved'}</small></footer>
    {viewer && !liveMine && !liveAll && <Dialog title="A little closer." className="mp-viewer" onClose={() => setViewer(null)}><img src={A + viewer.image} alt={viewer.alt}/><div className="mp-viewer-bottom"><span>Demo photograph · {viewer.date}</span><button className={`mp-heart ${liked.has(viewer.id) ? 'is-liked' : ''}`} aria-label={`${liked.has(viewer.id) ? 'Unlike' : 'Like'} enlarged demo photo`} aria-pressed={liked.has(viewer.id)} onClick={() => toggleLike(viewer.id)}><Icon name="heart"/>{viewer.likes + (liked.has(viewer.id) ? 1 : 0)}</button></div></Dialog>}
  </div>;
}
