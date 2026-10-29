import { useEffect, useState } from 'react';

export default function WishReaction({ wish, onReact }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (!burst) return;
    const timer = setTimeout(() => setBurst(0), 1000);
    return () => clearTimeout(timer);
  }, [burst]);

  async function toggle() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const active = !wish.reacted;
      await onReact(wish, active);
      if (active) setBurst(value => value + 1);
      else setBurst(0);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <div className="wish-reaction">
    <button type="button" className={`wish-react-button ${wish.reacted ? 'is-reacted' : ''}`} aria-label={wish.reacted ? 'Remove reaction' : 'React to wish'} aria-pressed={wish.reacted} disabled={busy} onClick={toggle}>
      <span aria-hidden="true">{wish.reacted ? '♥' : '♡'}</span> {wish.reactions}
    </button>
    {burst > 0 && <span key={burst} className="wish-reaction-burst" aria-hidden="true" onAnimationEnd={event => { if (event.target === event.currentTarget) setBurst(0); }}>♥</span>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
