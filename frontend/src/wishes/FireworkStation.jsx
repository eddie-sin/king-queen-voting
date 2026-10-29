import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const colors = ['#ffe5a3', '#ff9d7d', '#8bd8ef', '#e9b6f2', '#b8f2c9'];
const random = (min, max) => min + Math.random() * (max - min);
const pick = values => values[Math.floor(Math.random() * values.length)];
const sticks = [
  { color: '#ff4f36', tilt: '-13deg' },
  { color: '#00c9c2', tilt: '-6deg' },
  { color: '#ffd21f', tilt: '0deg' },
  { color: '#75df38', tilt: '7deg' },
  { color: '#b44dff', tilt: '14deg' },
];

function shapePoint(shape, angle) {
  if (['round', 'chrysanthemum', 'willow'].includes(shape)) return { x: Math.cos(angle), y: Math.sin(angle) };
  if (shape === 'heart') return { x: Math.sin(angle) ** 3, y: -(13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle)) / 17 };
  if (shape === 'butterfly') {
    const radius = (Math.exp(Math.cos(angle)) - 2 * Math.cos(4 * angle) - Math.sin(angle / 12) ** 5) / 3.2;
    return { x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius };
  }
  const radius = shape === 'flower' ? .7 + .3 * Math.cos(6 * angle) : .72 + .28 * Math.cos(5 * angle);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function FireworkShow({ show }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    // Reuse small glow textures so mobile devices avoid blurring hundreds of paths per frame.
    const sprites = new Map([...colors, '#fff1c0'].map(color => {
      const sprite = document.createElement('canvas'); sprite.width = sprite.height = 24;
      const brush = sprite.getContext('2d');
      const glow = brush.createRadialGradient(12, 12, 0, 12, 12, 12);
      glow.addColorStop(0, '#ffffff'); glow.addColorStop(.12, color);
      glow.addColorStop(.35, color + '90'); glow.addColorStop(1, color + '00');
      brush.fillStyle = glow; brush.fillRect(0, 0, 24, 24);
      return [color, sprite];
    }));
    let width, height, frame;
    const resize = () => {
      width = innerWidth; height = innerHeight;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const bursts = show.bursts.map(burst => ({ ...burst, particles: Array.from({ length: 210 }, (_, index) => {
      const point = shapePoint(burst.shape, (index < 160 ? index / 160 : Math.random()) * Math.PI * 2);
      const scatter = burst.shape === 'chrysanthemum' ? random(.3, 1) : index < 160 ? random(.96, 1.04) : random(.15, .85);
      return { x: point.x * scatter, y: point.y * scatter, radius: random(.6, 1.5), color: Math.random() < .8 ? burst.color : '#fff1c0', flicker: random(0, Math.PI * 2), life: random(2.1, 3.5), driftX: random(-4, 4), driftY: random(-2, 3) };
    }) }));
    const started = performance.now();
    const position = (burst, particle, age) => {
      // Sparks leave a single shell, lose speed, and fall under gravity.
      const spread = (1 - Math.exp(-(burst.shape === 'willow' ? 1.7 : 2.5) * age)) * burst.size * Math.min(width, 900);
      const drift = Math.max(0, age - .8) ** 2;
      return { x: burst.x * width + particle.x * spread + burst.wind * age + particle.driftX * drift, y: burst.y * height + particle.y * spread + (burst.shape === 'willow' ? 20 : 8) * age * age + particle.driftY * drift };
    };
    const draw = now => {
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';
      const elapsed = (now - started) / 1000;
      for (const burst of bursts) {
        const age = motion.matches ? 1 : elapsed - burst.delay;
        if (age < 0) continue;
        const flight = .9;
        if (!motion.matches && age < flight) {
          const progress = age / flight;
          const rocket = t => ({ x: show.origin.x * width + (burst.x - show.origin.x) * width * t, y: show.origin.y * height + (burst.y - show.origin.y) * height * (1 - (1 - t) ** 2) });
          const head = rocket(progress), tail = rocket(Math.max(0, progress - .12));
          context.globalAlpha = 1;
          context.strokeStyle = burst.color; context.lineWidth = 1.8;
          context.beginPath(); context.moveTo(tail.x, tail.y); context.lineTo(head.x, head.y); context.stroke();
          context.drawImage(sprites.get(burst.color), head.x - 10, head.y - 10, 20, 20);
          continue;
        }
        const sparkAge = motion.matches ? .8 : age - flight;
        if (sparkAge > 3.5) continue;
        const opacity = motion.matches ? .9 : Math.min(1, sparkAge * 22) * Math.max(0, 1 - Math.max(0, sparkAge - 1.2) / 2.3);
        if (!motion.matches && sparkAge < .16) {
          context.globalAlpha = (1 - sparkAge / .16) * .7;
          const radius = 18 + sparkAge * 100;
          context.drawImage(sprites.get(burst.color), burst.x * width - radius, burst.y * height - radius, radius * 2, radius * 2);
        }
        for (const particle of burst.particles) {
          const head = position(burst, particle, sparkAge);
          const fading = motion.matches ? 1 : Math.max(0, 1 - sparkAge / particle.life);
          context.globalAlpha = opacity * fading * (motion.matches ? 1 : .78 + .22 * Math.sin(sparkAge * 18 + particle.flicker));
          context.fillStyle = particle.color; context.strokeStyle = particle.color;
          if (!motion.matches) {
            const tail = position(burst, particle, Math.max(0, sparkAge - (burst.shape === 'willow' ? .24 : .12)));
            context.lineWidth = particle.radius * .7;
            context.beginPath(); context.moveTo(tail.x, tail.y); context.lineTo(head.x, head.y); context.stroke();
          }
          const radius = particle.radius * (1 - sparkAge * .12) * 5;
          context.drawImage(sprites.get(particle.color), head.x - radius, head.y - radius, radius * 2, radius * 2);
        }
      }
      if (!motion.matches && elapsed < 6.5) frame = requestAnimationFrame(draw);
    };
    const redraw = () => { cancelAnimationFrame(frame); resize(); draw(performance.now()); };
    redraw();
    window.addEventListener('resize', redraw);
    motion.addEventListener('change', redraw);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', redraw); motion.removeEventListener('change', redraw); };
  }, [show]);

  return <canvas ref={canvasRef} className="firework-canvas" data-bursts={JSON.stringify(show.bursts)} />;
}

export default function FireworkStation() {
  const [show, setShow] = useState(null);
  const station = useRef(null);
  const sequence = useRef(0);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  function launch() {
    const bounds = station.current.getBoundingClientRect();
    const shapes = ['flower', 'butterfly', 'heart', 'star'];
    const special = Math.random() < .6 ? Math.floor(Math.random() * 4) : -1;
    const bursts = Array.from({ length: 4 }, (_, index) => ({
      shape: index === special ? pick(shapes) : pick(['round', 'chrysanthemum', 'willow']),
      x: random(.23 + (index % 2) * .3, .44 + (index % 2) * .3),
      y: random(.28 + Math.floor(index / 2) * .17, .38 + Math.floor(index / 2) * .17),
      color: pick(colors), delay: index * random(.28, .48), size: random(.18, .23), wind: random(-4, 4),
    }));
    setShow({ id: ++sequence.current, bursts, origin: { x: (bounds.left + bounds.width / 2) / innerWidth, y: (bounds.top + bounds.height / 2) / innerHeight } });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(null), 6500);
  }

  return <>
    <button ref={station} className="firework-station" type="button" onClick={launch} aria-label="Launch fireworks" title="Launch fireworks">
      <span className="firework-sticks" aria-hidden="true">{sticks.map((stick, index) => <i key={index} className="firework-stick" style={{ '--stick-color': stick.color, '--stick-tilt': stick.tilt }}/>)}</span>
      <span className="firework-station-base" aria-hidden="true"/>
    </button>
    {show && createPortal(<div className="firework-display" aria-hidden="true"><FireworkShow key={show.id} show={show}/></div>, document.body)}
  </>;
}
