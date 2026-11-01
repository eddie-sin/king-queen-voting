import { Crown } from './Artwork.jsx';

export function ResultsPage({
  stage,
  results,
  load,
  error,
  onRetry,
  onRefreshControls,
}) {
  return (
    <section className="source-section">
      <div className="source-heading">
        <div className="eyebrow">KING &amp; QUEEN VOTING</div>
        <h1>
          The <em>results.</em>
        </h1>
        <p>Four titles. One celebration of our festival community.</p><nav className="award-category-links" aria-label="King and Queen pages"><a href="#king">King candidates</a><a href="#queen">Queen candidates</a><a href="#results" aria-current="page">Results</a></nav>
      </div>
      {stage !== 'announced' ? (
        <div className="empty-state">
          <Crown />
          <h2>
            {stage === 'unknown'
              ? 'Checking announcement status…'
              : 'Announcement is closed'}
          </h2>
          <p>The organisers will open the results after voting has closed.</p>
          <button className="btn secondary" onClick={onRefreshControls}>
            Refresh status
          </button>
        </div>
      ) : load === 'ready' && results ? (
        <div className="official-awards">
          {[0, 1].map(rank => <section className={`award-tier ${rank === 0 ? 'award-tier--royal' : ''}`} key={rank} aria-labelledby={`award-tier-${rank}`}>
            <div className="award-tier-heading"><span className="eyebrow">{rank === 0 ? 'THE FESTIVAL CROWNS' : 'THADINGYUT HONOURS'}</span><h2 id={`award-tier-${rank}`}>{rank === 0 ? 'Our King & Queen' : 'Mrs & Miss Thadingyut'}</h2></div>
            <div className="award-pair">{['king', 'queen'].map(contest => {
              const person = results[contest][rank];
              const title = rank === 0 ? contest === 'king' ? 'King' : 'Queen' : contest === 'king' ? 'Mrs Thadingyut' : 'Miss Thadingyut';
              return <article className="official-award-card" key={contest}>
                {person ? <>
                  <div className="award-portrait">{person.images[0] ? <img src={person.images[0]} alt={person.fullName} loading={rank === 0 ? 'eager' : 'lazy'} /> : <Crown />}<span className="award-title">{person.title}</span></div>
                  <div className="award-copy"><h3>{person.fullName}</h3>{person.batchNumber && <p className="meta">Batch {person.batchNumber}</p>}<p className="award-recorded-votes"><strong>{person.votes}</strong> {person.votes === 1 ? 'recorded vote' : 'recorded votes'}</p></div>
                </> : <div className="award-unfilled"><Crown /><h3>{title}</h3><p>No title holder announced in this category.</p></div>}
              </article>;
            })}</div>
          </section>)}
          <p className="award-note">Official titles announced by the festival organisers. Vote totals show the votes recorded for each title holder.</p>
        </div>
      ) : (
        <div className="empty-state" role="status">
          <p>{load === 'error' ? error : 'Loading the current totals…'}</p>
          <button className="btn secondary" onClick={onRetry}>
            Refresh results
          </button>
        </div>
      )}
    </section>
  );
}
