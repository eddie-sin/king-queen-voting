import { useLanguage, useT } from '../i18n/Language.jsx';
import { formatFestivalDate } from '../i18n/locale.js';
export function ReviewEnvelope({ rejected = false, demo = true, index = rejected ? 2 : 1, createdAt }) {
  const t = useT();
  const { language } = useLanguage();
  return <article className={`mp-review ${rejected ? 'mp-review-rejected' : ''}`}>
    <span className="mp-review-eyebrow">{t("YOUR ")}{t(demo ? 'DEMO ' : '')}{t("MEMORY · ")}{String(index + 1).padStart(2, '0')}</span>
    <div className="mp-envelope" aria-hidden="true"><div className="mp-envelope-paper">{t("GUSTO")}<br/><em>{t("a little light, kept safe.")}</em></div><div className="mp-envelope-fold"/><span className="mp-wax">✦</span><span className="mp-postmark">{t("THADINGYUT")}<br/>2026</span></div>
    <span className={`mp-status ${rejected ? 'mp-rejected' : 'mp-pending'}`}>{t(rejected ? 'Rejected' : 'Pending review')}</span>
    <h3>{t(rejected ? 'Some moments stay with us.' : 'A little patience. A little magic.')}</h3>
    <p>{t(rejected ? `This ${demo ? 'demo ' : ''}submission wasn’t approved for the public wall. Its active slot is released after private cleanup.` : 'Sealed with care while an administrator reviews your photo. Pending images stay off the public wall.')}</p>
    <span className="mp-review-note">{t(demo ? 'Sample review state · no real submission' : <time dateTime={createdAt}>{t("Submitted ")}{formatFestivalDate(createdAt, language)}</time>)}</span>
  </article>;
}
