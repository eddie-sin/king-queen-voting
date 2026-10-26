export function ReviewEnvelope({ rejected = false, demo = true, index = rejected ? 2 : 1, createdAt }) {
  return <article className={`mp-review ${rejected ? 'mp-review-rejected' : ''}`}>
    <span className="mp-review-eyebrow">YOUR {demo ? 'DEMO ' : ''}MEMORY · {String(index + 1).padStart(2, '0')}</span>
    <div className="mp-envelope" aria-hidden="true"><div className="mp-envelope-paper">GUSTO<br/><em>a little light, kept safe.</em></div><div className="mp-envelope-fold"/><span className="mp-wax">✦</span><span className="mp-postmark">THADINGYUT<br/>2026</span></div>
    <span className={`mp-status ${rejected ? 'mp-rejected' : 'mp-pending'}`}>{rejected ? 'Rejected' : 'Pending review'}</span>
    <h3>{rejected ? 'Some moments stay with us.' : 'A little patience. A little magic.'}</h3>
    <p>{rejected ? `This ${demo ? 'demo ' : ''}submission wasn’t approved for the public wall. Its active slot is released after private cleanup.` : 'Sealed with care while an administrator reviews your photo. Pending images stay off the public wall.'}</p>
    <span className="mp-review-note">{demo ? 'Sample review state · no real submission' : <time dateTime={createdAt}>Submitted {new Date(createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Yangon' })}</time>}</span>
  </article>;
}
