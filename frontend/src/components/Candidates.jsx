import { Crown } from './Artwork.jsx';
import { Dialog } from './Dialog.jsx';
import { PhotoCarousel } from './PhotoCarousel.jsx';
import { titleCase } from '../domain.js';

export function CategorySelection({ onSelect }) {
  return <div className="royals" aria-label="Choose a contest">{['king', 'queen'].map(contest => <a key={contest} className={`royal ${contest}`} href={`#${contest}`} onClick={e=>{e.preventDefault();onSelect(contest);}}>
    <img className="royal-art" src={`${import.meta.env.BASE_URL}art/source-${contest}.svg`} alt=""/>
    <div className="royal-copy"><span className="eyebrow">{contest === 'king' ? 'THE GRACE OF A KING' : 'THE RADIANCE OF A QUEEN'}</span><h3>Meet the <em>{titleCase(contest)}s</em></h3><p>Discover the personalities.<br/>Find your favourite. Let them shine.</p><span className="text-link">Explore {contest} candidates</span></div>
  </a>)}</div>;
}
export function CandidateCard({ candidate, selected, onView, paused, number = 1 }) {
  return <article className={`candidate-card ${selected ? 'is-selected' : ''}`}>
    <PhotoCarousel images={candidate.images} name={candidate.fullName} paused={paused}/>
    {selected && <span className="saved-badge">✓ Your choice</span>}
    <div className="candidate-copy"><span className="eyebrow">{candidate.category.toUpperCase()} · {String(number).padStart(2,'0')}</span><h3>{candidate.fullName}</h3>
      {candidate.batchNumber && <p className="meta">Batch of {candidate.batchNumber}</p>}
      <button className="btn secondary" onClick={() => onView(candidate)}>Meet {candidate.fullName.split(' ')[0]}</button>
    </div>
  </article>;
}
export function CandidateProfile({ candidate, selected, canVote, actionLabel, onVote, onClose, paused, votingStatus }) {
  return <Dialog title={candidate.fullName} onClose={onClose} className="profile-dialog">
    <div className="profile-layout"><PhotoCarousel images={candidate.images} name={candidate.fullName} paused={paused}/>
      <div className="profile-copy"><h2>{candidate.fullName}</h2><span className="eyebrow">{titleCase(candidate.category)} candidate</span>
        {candidate.nickname && <p className="nickname">“{candidate.nickname}”</p>}
        <dl className="profile-facts">
          {candidate.batchNumber && <div><dt>Batch</dt><dd>{candidate.batchNumber}</dd></div>}
          {candidate.age != null && <div><dt>Age</dt><dd>{candidate.age}</dd></div>}
          {candidate.zodiacSign && <div><dt>Zodiac sign</dt><dd>{candidate.zodiacSign}</dd></div>}
        </dl>
        {candidate.bio && <p className="biography">{candidate.bio}</p>}
        {candidate.hobbiesAndInterests?.length > 0 && <div className="interests"><h3>Little things they love</h3><div>{candidate.hobbiesAndInterests.map((hobby, index) => <span className="chip" key={`${hobby}-${index}`}>{hobby}</span>)}</div></div>}
        <div className="profile-action"><Crown/>{selected ? <p className="gold">✓ Your crown is here</p> : <button className="btn primary" disabled={!canVote} onClick={() => onVote(candidate)}>{actionLabel}</button>}
        <p className="fine-print">{votingStatus === 'open' ? 'One King. One Queen. Your choices, your celebration.' : 'Meet the candidates now. The organisers control when voting opens.'}</p></div>
      </div>
    </div>
  </Dialog>;
}
