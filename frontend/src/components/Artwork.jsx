export function Crown({ className = '' }) {
  return <svg className={className} viewBox="0 0 64 56" fill="none" aria-hidden="true"><path d="m8 18 12 10L32 9l12 19 12-10-6 27H14L8 18Z" stroke="currentColor" strokeWidth="1.4"/><path d="M16 49h32M20 37h24" stroke="currentColor"/><circle cx="8" cy="15" r="2" fill="currentColor"/><circle cx="32" cy="6" r="2" fill="currentColor"/><circle cx="56" cy="15" r="2" fill="currentColor"/></svg>;
}
export function Brand() {
  return <span className="brand"><span className="brand-mark" aria-hidden="true">♧</span><span>THADINGYUT<small>FESTIVAL OF LIGHTS</small></span></span>;
}
export function Sky() {
  return <div className="festival-sky" aria-hidden="true">
    {Array.from({ length: 90 }, (_, i) => <i key={i} className={`star ${i % 11 === 0 ? 'star-cross' : ''}`} style={{ left: `${(i * 37.73) % 100}%`, top: `${(i * 19.17) % 100}%`, '--duration': `${5 + i % 5}s`, '--delay': `${-i % 9}s` }}/>) }
  </div>;
}
export function Landscape() {
  return <svg className="horizon" viewBox="0 0 1400 180" preserveAspectRatio="none" aria-hidden="true"><path d="M0 95Q150 30 330 110T670 100T1000 100T1400 70V180H0Z" fill="#102a45"/><path d="M0 145Q130 75 300 140T650 130T1000 135T1400 120V180H0Z" fill="#0a2039"/><path d="M0 167Q200 147 400 169T800 161T1400 165V180H0Z" fill="#081a31"/></svg>;
}
