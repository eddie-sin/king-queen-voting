import { useT } from '../i18n/Language.jsx';
import { Crown } from './Artwork.jsx';

export function ResultsPage({
  stage,
  results,
  load,
  error,
  onRetry,
  onRefreshControls,
}) {
  const t = useT();
  return (
    <section className="source-section">
      <div className="source-heading">
        <div className="eyebrow">{t("KING & QUEEN VOTING")}</div>
        <h1>{t("The ")}<em>{t("results.")}</em>
        </h1>
        <p>{t("Celebrating our title holders and their recorded votes.")}</p>
      </div>
      {stage !== 'announced' ? (
        <div className="empty-state">
          <Crown />
          <h2>
            {t(stage === 'unknown'
              ? 'Checking announcement status…'
              : 'Announcement is closed')}
          </h2>
          <p>{t("The organisers will open the results after voting has closed.")}</p>
          <button className="btn secondary" onClick={onRefreshControls}>{t("Refresh status")}</button>
        </div>
      ) : load === 'ready' && results ? (
        ['king', 'queen'].map(contest => (
          <div className="source-section results-contest-section" key={contest}>
            <h2 className="results-contest-heading">
              {t(contest === 'king' ? 'King' : 'Queen')}{t(" title holders")}</h2>
            {!results[contest].length ? (
              <p>{t("No title has been awarded in this category.")}</p>
            ) : (
              <div className="gallery">
                {results[contest].map(person => (
                  <article className="candidate-card" key={person._id}>
                    {person.images[0] && (
                      <img
                        src={person.images[0]}
                        alt={person.fullName}
                        loading="lazy"
                        style={{
                          width: '100%',
                          aspectRatio: '4/5',
                          objectFit: 'cover',
                        }}
                      />
                    )}
                    <div className="candidate-copy">
                      <p className="eyebrow">{t(person.title)}</p>
                      <h3>{person.fullName}</h3>
                      <p className="meta">
                        {t(person.batchNumber && `Batch ${person.batchNumber} · `)}
                        {t(person.isActive ? '' : 'Inactive candidate')}
                      </p>
                      <strong className="result-votes">
                        {person.votes} {t(person.votes === 1 ? 'vote' : 'votes')}
                      </strong>
                      {results[contest].filter(c => c.votes === person.votes).length >
                        1 && <p className="fine-print">{t("Tied at this total")}</p>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ))
      ) : (
        <div className="empty-state" role="status">
          <p>{t(load === 'error' ? error : 'Loading the current totals…')}</p>
          <button className="btn secondary" onClick={onRetry}>{t("Refresh results")}</button>
        </div>
      )}
    </section>
  );
}
