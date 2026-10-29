import { useEffect, useState } from 'react';
import WishReaction from './WishReaction.jsx';

function SavedWishes({ api, token, onRequireLogin }) {
  const [result, setResult] = useState({ state: 'loading', wishes: [], error: '', expired: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ state: 'loading', wishes: [], error: '', expired: false });
    api.myWishes(token, { signal: controller.signal }).then(wishes => {
      if (!controller.signal.aborted) setResult({ state: 'ready', wishes, error: '', expired: false });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ state: 'error', wishes: [], error: error.message, expired: error.status === 401 });
    });
    return () => controller.abort();
  }, [api, token, retry]);

  async function react(wish, active) {
    const reaction = await api.react(wish.id, active);
    setResult(previous => ({ ...previous, wishes: previous.wishes.map(item => item.id === wish.id ? { ...item, ...reaction } : item) }));
  }

  if (result.state === 'loading') return <p role="status">Gathering your wishes…</p>;
  if (result.state === 'error') return <div role="alert"><p>{result.error}</p><button className="btn secondary" onClick={result.expired ? onRequireLogin : () => setRetry(value => value + 1)}>{result.expired ? 'Sign in' : 'Try again'}</button></div>;
  if (!result.wishes.length) return <div className="my-wishes-empty"><p>You haven’t released a wish yet.</p><a className="btn primary" href="#wishes">Release a wish</a></div>;
  return <div className="my-wishes-list">{result.wishes.map((wish, index) => <article key={wish.id} className="my-wish-card" aria-label={`Your wish ${index + 1}`}>
    <p className="my-wish-message">{wish.message}</p>
    {wish.name && <p className="wish-signature">— {wish.name}</p>}
    <WishReaction wish={wish} onReact={react}/>
  </article>)}</div>;
}

export default function MyWishes({ api, session, onRequireLogin }) {
  function replayTutorial() {
    try { localStorage.removeItem('wish-sky-tour-v1'); } catch { /* The sky shows its tour when storage is unavailable. */ }
  }
  return <section className="source-section my-wishes-page" aria-labelledby="my-wishes-title">
    <div className="source-heading"><span className="eyebrow">YOUR LITTLE LIGHTS</span><h1 id="my-wishes-title">My <em>wishes.</em></h1><p>The wishes you’ve sent into the sky, saved here to revisit.</p></div>
    <div className="my-wishes-links"><a className="text-button" href="#account">Back to account</a><a className="text-button" href="#wishes" onClick={replayTutorial}>See tutorial</a><a className="text-button" href="#wishes">Visit the wish sky</a></div>
    {session ? <SavedWishes key={session.token} api={api} token={session.token} onRequireLogin={onRequireLogin}/> : <div className="my-wishes-empty"><p>Sign in to revisit the wishes you’ve released.</p><button className="btn primary" onClick={onRequireLogin}>Sign in</button></div>}
  </section>;
}
