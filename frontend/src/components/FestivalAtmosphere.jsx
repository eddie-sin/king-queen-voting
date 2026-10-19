import { Lantern } from './Artwork.jsx';

/** Purely decorative atmosphere; no voting state or API calls. */
export default function FestivalAtmosphere() {
  return <div className="festival-atmosphere" aria-hidden="true">
    <div className="atmosphere-cloud atmosphere-cloud-one" />
    <div className="atmosphere-cloud atmosphere-cloud-two" />
    {Array.from({ length: 15 }, (_, i) => <div key={`light-${i}`} className="atmosphere-floating-light" style={{
      '--x': `${(i * 31.71 + 6) % 96}%`,
      '--rise-duration': `${27 + (i % 6) * 4}s`,
      '--rise-delay': `${-i * 5.7}s`,
      '--size': `${25 + (i % 4) * 9}px`,
      '--drift': `${((i % 5) - 2) * 19}px`,
      '--light-opacity': `${0.36 + (i % 4) * 0.11}`,
    }}><Lantern left="0" top="0" size={25 + (i % 4) * 9} delay={-i * 1.1}/></div>)}
    {Array.from({length: 23}, (_, i) => <i key={`firefly-${i}`} className="atmosphere-firefly" style={{
      left: `${(i * 47.31 + 9) % 97}%`, top: `${(i * 23.17 + 11) % 94}%`,
      animationDelay: `${-i * 1.37}s`, animationDuration: `${7 + i % 7}s`
    }}/>) }
  </div>;
}
