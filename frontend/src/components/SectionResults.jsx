import { useT } from '../i18n/Language.jsx';
export function SectionResultsLink({ href, label = 'Results' }) {
  const t = useT();
  return <div className="section-results-row">
    <a className="section-results-tab" href={href}>{t(label)}</a>
  </div>;
}

export function LanternResultsPage() {
  const t = useT();
  return <div className="lantern-results-page">
    <SectionResultsLink href="#lanterns" label="Back to Lanterns"/>
    <section className="lantern-results-card">
      <span className="lantern-results-icon" aria-hidden="true">🏮</span>
      <p className="eyebrow">{t("LANTERN RESULTS")}</p>
      <h1>{t("Results will shine ")}<em>{t("here.")}</em></h1>
      <p>{t("The Lantern results have not been published yet. Please return when the festival team announces them.")}</p>
    </section>
  </div>;
}
