import { useT } from '../i18n/Language.jsx';
import { Crown } from './Artwork.jsx';
import { Dialog } from './Dialog.jsx';
import { PhotoCarousel } from './PhotoCarousel.jsx';
import { titleCase } from '../domain.js';

export function CategorySelection({ onSelect }) {
  const t = useT();
  return (
    <div className="royals" aria-label={t("Choose a contest")}>
      {['king', 'queen'].map(contest => (
        <a
          key={contest}
          className={`royal ${contest}`}
          href={`#${contest}`}
          onClick={e => {
            e.preventDefault();
            onSelect(contest);
          }}
        >
          <img
            className="royal-art"
            src={`${import.meta.env.BASE_URL}art/source-${contest}.svg`}
            alt=""
          />
          <div className="royal-copy">
            <span className="eyebrow">
              {t(contest === 'king' ? 'THE GRACE OF A KING' : 'THE RADIANCE OF A QUEEN')}
            </span>
            <h3>{t("Meet the ")}<em>{t(titleCase(contest))}{t("s")}</em>
            </h3>
            <p>{t("Discover the personalities.")}<br />{t("Find your favourite. Let them shine.")}</p>
            <span className="text-link">{t("Explore ")}{t(contest)}{t(" candidates")}</span>
          </div>
        </a>
      ))}
    </div>
  );
}

export function CandidateCard({ candidate, selected, onView, paused, number = 1 }) {
  const t = useT();
  return (
    <article className={`candidate-card ${selected ? 'is-selected' : ''}`}>
      <PhotoCarousel
        images={candidate.images}
        name={candidate.fullName}
        paused={paused}
      />
      {selected && <span className="saved-badge">{t("✓ Your choice")}</span>}
      <div className="candidate-copy">
        <span className="eyebrow">
          {t(candidate.category.toUpperCase())} · {String(number).padStart(2, '0')}
        </span>
        <h3>{candidate.fullName}</h3>
        {candidate.batchNumber && (
          <p className="meta">{t("Batch of ")}{candidate.batchNumber}</p>
        )}
        <button className="btn secondary" onClick={() => onView(candidate)}>{t("Meet ")}{candidate.fullName.split(' ')[0]}
        </button>
      </div>
    </article>
  );
}

export function CandidateProfile({
  candidate,
  selected,
  canVote,
  actionLabel,
  onVote,
  onClose,
  paused,
  votingStatus,
}) {
  const t = useT();
  return (
    <Dialog title={<span translate="no">{candidate.fullName}</span>} onClose={onClose} className="profile-dialog">
      <div className="profile-layout">
        <PhotoCarousel
          images={candidate.images}
          name={candidate.fullName}
          paused={paused}
        />
        <div className="profile-copy">
          <h2>{candidate.fullName}</h2>
          <span className="eyebrow">{t(titleCase(candidate.category))}{t(" candidate")}</span>
          {candidate.nickname && <p className="nickname">“{candidate.nickname}”</p>}
          <dl className="profile-facts">
            {candidate.batchNumber && (
              <div>
                <dt>{t("Batch")}</dt>
                <dd>{candidate.batchNumber}</dd>
              </div>
            )}
            {candidate.age != null && (
              <div>
                <dt>{t("Age")}</dt>
                <dd>{candidate.age}</dd>
              </div>
            )}
            {candidate.zodiacSign && (
              <div>
                <dt>{t("Zodiac sign")}</dt>
                <dd>{candidate.zodiacSign}</dd>
              </div>
            )}
          </dl>
          {candidate.bio && <p className="biography">{candidate.bio}</p>}
          {candidate.hobbiesAndInterests?.length > 0 && (
            <div className="interests">
              <h3>{t("Little things they love")}</h3>
              <div>
                {candidate.hobbiesAndInterests.map((hobby, index) => (
                  <span className="chip" key={`${hobby}-${index}`}>
                    {hobby}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="profile-action">
            <Crown />
            {selected ? (
              <p className="gold">{t("✓ Your crown is here")}</p>
            ) : (
              <button
                className="btn primary"
                disabled={!canVote}
                onClick={() => onVote(candidate)}
              >
                {t(actionLabel)}
              </button>
            )}
            <p className="fine-print">
              {t(votingStatus === 'open'
                ? 'One King. One Queen. Your choices, your celebration.'
                : 'Meet the candidates now. The organisers control when voting opens.')}
            </p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
