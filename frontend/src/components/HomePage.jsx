import { useT } from '../i18n/Language.jsx';
import { Crown } from '../components.jsx';

const EVENT = {
  date: "6 November 2026",
  time: '9:00 AM – 3:00 PM',
  venue: 'Main Hall, Junction Square Campus, GUSTO College',
};

export default function HomePage() {
  const t = useT();
  return <div className="home-page">
    <div className="home-atmosphere" aria-hidden="true">
      {Array.from({ length: 56 }, (_, i) => <i className={`home-spark ${i % 7 === 0 ? 'home-spark-cross' : ''}`} key={i} style={{ '--x': `${i % 2 ? 82 + (i * 7.3) % 16 : 2 + (i * 5.7) % 16}%`, '--y': `${3 + (i * 13.7) % 94}%`, '--delay': `${-(i % 13)}s`, '--duration': `${6 + i % 7}s` }} />)}
      {[['6%', '20%'], ['92%', '34%'], ['4%', '49%'], ['94%', '65%'], ['7%', '81%'], ['91%', '94%']].map(([x, y], i) => <span className="home-floating-lantern" key={i} style={{ '--x': x, '--y': y, '--delay': `${-i * 3}s`, '--duration': `${15 + i * 2}s` }} />)}
    </div>
    <section className="home-hero" aria-labelledby="home-title">
      <img className="home-hero-image" src="/art/thadingyut-college-hero.png" alt="" fetchPriority="high" />
      <div className="home-hero-copy">
        <span className="eyebrow">{t("GUSTO COLLEGE · OUR THADINGYUT TOGETHER")}</span>
        <h1 id="home-title">{t("Let the lanterns glow,")}<br/><em>{t("and the memories grow.")}</em></h1>
        <p>{t("Come together for the warmth of Thadingyut, music, and laughter. Let’s bring our cherished traditions and friendships to GUSTO College and make a day to remember.")}</p>
        <button className="btn primary" onClick={() => document.getElementById('home-event').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}>{t("Discover the festival ")}<span aria-hidden="true">↓</span></button>
      </div>
      <span className="home-hero-caption">{t("THADINGYUT · FESTIVAL OF LIGHTS")}</span>
    </section>

    <div className="home-sections">
      <section className="home-event home-block" id="home-event" aria-labelledby="event-title">
        <div><span className="eyebrow">{t("01 / A MOMENT TO COME TOGETHER")}</span><h2 id="event-title">{t("Something to look forward to —")}<br/><em>{t("our Thadingyut celebration.")}</em></h2><p>{t("Bring your friends, meet new faces, and share a joyful festival day together.")}</p><a className="home-link" href="#entertainment">{t("Explore the entertainment ")}<span aria-hidden="true">↗</span></a></div>
        <dl className="home-details"><div><dt>{t("Date")}</dt><dd>{t(EVENT.date)}</dd></div><div><dt>{t("Time")}</dt><dd>{t(EVENT.time)}</dd></div></dl>
      </section>

      <section className="home-location home-block" aria-labelledby="location-title">
        <div className="home-location-art" aria-hidden="true"><svg viewBox="0 0 200 140" fill="none"><ellipse cx="100" cy="110" rx="70" ry="18"/><ellipse cx="100" cy="110" rx="44" ry="10"/><path d="M100 110s35-37 35-65a35 35 0 0 0-70 0c0 28 35 65 35 65Z"/><circle cx="100" cy="45" r="12"/></svg></div>
        <div><span className="eyebrow">{t("02 / LET’S MEET HERE")}</span><h2 id="location-title">{t("A place for us ")}<em>{t("to come together.")}</em></h2><h3>{t(EVENT.venue)}</h3><p>{t("Meet us at GUSTO College’s Main Hall, Junction Square Campus. Bring your friends, share the warmth of Thadingyut, and make new memories together.")}</p></div>
      </section>

      <section className="home-voting home-block" aria-labelledby="voting-title">
        <div className="home-crown" aria-hidden="true"><Crown /></div><span className="eyebrow">{t("03 / LET YOUR SUPPORT HELP THEM SHINE")}</span>
        <h2 id="voting-title">{t("Cheer for your favourites.")}<br/><em>{t("Bring their crown dreams to life.")}</em></h2><p>{t("Who reflects the confidence, kindness, and togetherness of GUSTO College? Meet our King & Queen candidates and cast your vote for your favourites.")}</p><a className="btn primary" href="#candidates">{t("King & Queen candidates ")}<span aria-hidden="true">↗</span></a><span className="home-small">{t("Meet the candidates. Find your favourites. Let your vote cheer them on.")}</span>
      </section>

      <section className="home-feature home-block" aria-labelledby="lantern-title">
        <div className="home-lantern-art" aria-hidden="true"><span/><span/><span/></div>
        <div><span className="eyebrow">{t("04 / WARMTH IN EVERY GLOW")}</span><h2 id="lantern-title">{t("Every lantern")}<br/><em>{t("holds a story.")}</em></h2><p>{t("Discover lanterns shaped by our students’ imagination and care. Each one brings its own little light to our festival.")}</p><a className="home-link" href="#lanterns">{t("Explore the lantern gallery ")}<span aria-hidden="true">↗</span></a></div>
      </section>

      <section className="home-feature home-wishes home-block" aria-labelledby="wishes-title">
        <div><span className="eyebrow">{t("05 / LET YOUR WISHES DRIFT WITH THE LIGHT")}</span><h2 id="wishes-title">{t("Under one shared sky,")}<br/><em>{t("let’s share our wishes.")}</em></h2><p>{t("A dream for tomorrow, a thank-you for today, a little wish for someone you love… Leave your wish in the sky we light together.")}</p><a className="home-link" href="#wishes">{t("Make a wish in Wish Sky ")}<span aria-hidden="true">↗</span></a></div>
        <div className="home-wish-art" aria-hidden="true"><span>✧</span><span>✦</span><span>✧</span><img src="/art/wish-balloon.svg" alt="" loading="lazy"/></div>
      </section>

      <section className="home-coming home-block" aria-labelledby="memory-title"><span className="eyebrow">{t("06 / KEEP IT AS A MEMORY")}</span><h2 id="memory-title">{t("Today’s little joys,")}<br/><em>{t("tomorrow’s memories.")}</em></h2><p>{t("Keep the smiles, friendships, and little moments that will warm your heart every time you look back.")}</p><a className="home-link" href="#memory-gallery">{t("Memory Photo gallery ↗")}</a></section>
      <section className="home-coming home-developers home-block" aria-labelledby="developer-title"><span className="eyebrow">{t("07 / THE CREATORS BEHIND THE LIGHT")}</span><h2 id="developer-title">{t("For our GUSTO College,")}<br/><em>{t("made with care.")}</em></h2><p>{t("Meet the team who put their hearts into this website so we can share the joy of our festival together.")}</p><a className="home-link" href="#developers">{t("Meet the developers ")}<span aria-hidden="true">↗</span></a></section>
    </div>
  </div>;
}
