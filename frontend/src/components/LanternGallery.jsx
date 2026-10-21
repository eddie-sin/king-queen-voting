export function LanternGallery({ lanterns, state, error, onRetry }) {
  if (state === 'loading') return <div className="empty-state" role="status">Lighting the lantern gallery…</div>;
  if (state === 'error') return <div className="empty-state" role="alert"><h3>The lanterns need a moment.</h3><p>{error}</p><button className="btn secondary" onClick={onRetry}>Retry lanterns</button></div>;
  if (!lanterns.length) return <div className="empty-state"><span aria-hidden="true">◇</span><h3>The first light is still to come.</h3><p>Lantern stories will appear here once the festival team adds them.</p></div>;
  return <div className="lantern-grid">{lanterns.map(lantern => <article className="lantern-card" key={lantern._id}>
    <img src={lantern.url} alt={lantern.title}/><div><p className="eyebrow">FESTIVAL LANTERN</p><h2>{lantern.title}</h2>{lantern.description && <p>{lantern.description}</p>}</div>
  </article>)}</div>;
}
