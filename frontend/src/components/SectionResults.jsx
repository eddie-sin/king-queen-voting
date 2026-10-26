export function SectionResultsLink({ href, label = 'Results' }) {
  return <div className="section-results-row">
    <a className="section-results-tab" href={href}>{label}</a>
  </div>;
}

export function LanternResultsPage() {
  return <div className="lantern-results-page">
    <SectionResultsLink href="#lanterns" label="Back to Lanterns"/>
    <section className="lantern-results-card">
      <span className="lantern-results-icon" aria-hidden="true">🏮</span>
      <p className="eyebrow">LANTERN RESULTS</p>
      <h1>Results will shine <em>here.</em></h1>
      <p>The Lantern results have not been published yet. Please return when the festival team announces them.</p>
    </section>
  </div>;
}
