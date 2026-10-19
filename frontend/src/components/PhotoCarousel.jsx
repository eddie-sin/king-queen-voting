import { useEffect, useRef, useState } from 'react';

function Photo({ src, name, index }) {
  const [broken, setBroken] = useState(false);
  return broken ? <div className="photo-missing">Photo unavailable</div> : <img src={src} alt={`${name}, photo ${index + 1}`} onError={() => setBroken(true)} loading="lazy" draggable="false"/>;
}
export function PhotoCarousel({ images = [], name, paused = false }) {
  const photos = images.slice(0, 3);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hover, setHover] = useState(false);
  const [reduced, setReduced] = useState(false);
  const touch = useRef(null);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches); update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (paused || reduced || hover || !playing || photos.length < 2) return;
    const timer = setInterval(() => setIndex(value => (value + 1) % photos.length), 5500);
    return () => clearInterval(timer);
  }, [photos.length, paused, reduced, hover, playing]);
  const move = value => { setPlaying(false); setIndex((value + photos.length) % photos.length); };
  if (!photos.length) return <div className="photo-carousel photo-missing"><span>✧</span><p>Photo coming soon</p></div>;
  return <div className="photo-carousel" role="group" aria-label={`Photos of ${name}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    onFocus={() => setHover(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHover(false); }}
    onTouchStart={e => { touch.current = e.touches[0].clientX; }}
    onTouchEnd={e => { if (touch.current !== null && photos.length > 1) { const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 45) move(index + (dx < 0 ? 1 : -1)); } touch.current = null; }}>
    {photos.map((src, i) => <div key={`${src}-${i}`} className={`photo-slide ${i === index ? 'active' : ''}`} aria-hidden={i !== index}><Photo src={src} name={name} index={i}/></div>)}
    {photos.length > 1 && <div className="photo-controls">
      <button aria-label="Previous photo" onClick={() => move(index - 1)}>‹</button>
      <div className="photo-dots">{photos.map((_, i) => <button key={i} aria-label={`Show photo ${i + 1} of ${photos.length}`} aria-pressed={index === i} onClick={() => move(i)}><span/></button>)}</div>
      <button aria-label="Next photo" onClick={() => move(index + 1)}>›</button>
      <button className="photo-play" disabled={paused || reduced} aria-label={playing ? 'Pause slideshow' : 'Play slideshow'} onClick={() => setPlaying(v => !v)}>{playing && !paused && !reduced ? 'Ⅱ' : '▷'}</button>
    </div>}
    <span className="photo-count" aria-live="off">{index + 1} / {photos.length}</span>
  </div>;
}
