import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const steps = [
  { id: 'lantern', title: 'Read a wish', text: 'Tap the circled lantern to open the wish inside. You can leave a heart there, too.', click: '.floating-wish' },
  { id: 'music', title: 'Play or pause', text: 'Tap the circled music control to play or pause the song.', target: '.music-player-play', click: '.music-player-play' },
  { id: 'volume', title: 'Adjust the volume', text: 'Tap the circled speaker to open the volume slider.', target: '.music-player-volume', click: '.music-player-volume' },
  { id: 'fireworks', title: 'Light up the sky', text: 'Tap the colorful firework sticks for a sky show.', target: '.firework-station', click: '.firework-station' },
  { id: 'release', title: 'Release your wish', text: 'Tap Release a wish to send your own lantern. You will be asked to sign in only when needed.', target: '.sky-actions .btn.primary', click: '.sky-actions .btn.primary' },
];

function findTarget(step) {
  if (step.target) return document.querySelector(step.target);
  const sample = document.querySelector('.tutorial-sample-wish .wish-lantern-shape');
  if (sample) return sample;
  return [...document.querySelectorAll('.floating-wish .wish-lantern-shape')].find(element => {
    const rect = element.getBoundingClientRect();
    return rect.left > 12 && rect.right < innerWidth - 12 && rect.top > 110 && rect.bottom < innerHeight - 140;
  });
}

export default function WishSkyTour({ onDone }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const nextRef = useRef(null);
  const step = steps[index];

  useEffect(() => {
    const update = () => {
      const target = findTarget(step);
      if (!target) { setRect(null); return; }
      const next = target.getBoundingClientRect();
      setRect(previous => previous && Math.abs(previous.left - next.left) < 2 && Math.abs(previous.top - next.top) < 2 && previous.width === next.width && previous.height === next.height
        ? previous : { left: next.left, top: next.top, width: next.width, height: next.height });
    };
    update();
    const interval = setInterval(update, 120);
    window.addEventListener('resize', update);
    return () => { clearInterval(interval); window.removeEventListener('resize', update); };
  }, [step]);

  useEffect(() => {
    const handleClick = event => {
      if (step.id !== 'release' && event.target.closest('.sky-actions .btn.primary')) { onDone(); return; }
      if (!event.target.closest(step.click)) return;
      if (index === steps.length - 1) onDone();
      else setIndex(index + 1);
    };
    const handleKey = event => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) onDone(); };
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('click', handleClick, true); document.removeEventListener('keydown', handleKey); };
  }, [index, onDone, step]);

  useEffect(() => { nextRef.current?.focus(); }, [index, Boolean(rect)]);

  if (!rect) return null;
  const width = Math.min(300, innerWidth - 24);
  const left = Math.max(12, Math.min(innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
  const desiredTop = rect.top > innerHeight * .55 ? rect.top - 164 : rect.top + rect.height + 18;
  const top = Math.max(82, Math.min(innerHeight - 170, desiredTop));

  return createPortal(<div className="wish-tour" aria-label="Wish Sky introduction">
    <div className={`wish-tour-spotlight ${step.id === 'lantern' ? 'is-lantern' : ''}`} style={{ left: rect.left - 8, top: rect.top - 8, width: rect.width + 16, height: rect.height + 16 }}/>
    <div className="wish-tour-card" role="region" aria-live="polite" style={{ left, top, width }}>
      <span className="wish-tour-progress">{index + 1} / {steps.length}</span>
      <h3>{step.title}</h3>
      <p>{step.text}</p>
      <div className="wish-tour-actions"><button type="button" className="text-button" onClick={onDone}>Skip tutorial</button><button type="button" className="btn primary" ref={nextRef} onClick={() => index === steps.length - 1 ? onDone() : setIndex(index + 1)}>{index === steps.length - 1 ? 'Finish' : 'Next'}</button></div>
    </div>
  </div>, document.body);
}
