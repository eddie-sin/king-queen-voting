import { Crown } from '../components.jsx';

const EVENT = {
  date: '၂၀၂၆ ခုနှစ်၊ နိုဝင်ဘာလ ၆ ရက်',
  time: '9:00 AM – 3:00 PM',
  venue: 'Main Hall, Junction Square Campus, GUSTO College',
};

export default function HomePage() {
  return <div className="home-page" lang="my">
    <div className="home-atmosphere" aria-hidden="true">
      {Array.from({ length: 56 }, (_, i) => <i className={`home-spark ${i % 7 === 0 ? 'home-spark-cross' : ''}`} key={i} style={{ '--x': `${i % 2 ? 82 + (i * 7.3) % 16 : 2 + (i * 5.7) % 16}%`, '--y': `${3 + (i * 13.7) % 94}%`, '--delay': `${-(i % 13)}s`, '--duration': `${6 + i % 7}s` }} />)}
      {[['6%', '20%'], ['92%', '34%'], ['4%', '49%'], ['94%', '65%'], ['7%', '81%'], ['91%', '94%']].map(([x, y], i) => <span className="home-floating-lantern" key={i} style={{ '--x': x, '--y': y, '--delay': `${-i * 3}s`, '--duration': `${15 + i * 2}s` }} />)}
    </div>
    <section className="home-hero" aria-labelledby="home-title">
      <img className="home-hero-image" src="/art/thadingyut-college-hero.png" alt="" fetchPriority="high" />
      <div className="home-hero-copy">
        <span className="eyebrow">GUSTO COLLEGE · တို့အတူ ဆင်နွှဲမယ့် သီတင်းကျွတ်</span>
        <h1 id="home-title">ဆီမီးရောင်စုံ ထွန်းလင်းလို့<br/><em>အမှတ်တရတွေ ဝေစည်စို့။</em></h1>
        <p>သီတင်းကျွတ်ရဲ့ ကြည်နူးဖွယ်အငွေ့အသက်တွေနဲ့အတူ တေးသံတွေ၊ ရယ်မောသံတွေနဲ့အတူ ဆုံတွေ့ကြမယ်။ မြတ်နိုးရတဲ့ ရိုးရာအလှနဲ့ သူငယ်ချင်းတို့ရဲ့ နွေးထွေးမှုကို ပေါင်းစည်းပြီး GUSTO College မှာ အမှတ်တရနေ့လေးတစ်နေ့ အတူဖန်တီးကြရအောင်။</p>
        <button className="btn primary" onClick={() => document.getElementById('home-event').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}>ပွဲတော်အကြောင်း ကြည့်ရှုမယ် <span aria-hidden="true">↓</span></button>
      </div>
      <span className="home-hero-caption">THADINGYUT · FESTIVAL OF LIGHTS</span>
    </section>

    <div className="home-sections">
      <section className="home-event home-block" id="home-event" aria-labelledby="event-title">
        <div><span className="eyebrow">01 / အတူဆုံမယ့် အချိန်လေး</span><h2 id="event-title">မျှော်လင့်ရင်ခုန်စရာ<br/><em>သီတင်းကျွတ်ပွဲတော်။</em></h2><p>သူငယ်ချင်းတွေနဲ့အတူ လာခဲ့ပါ။ မိတ်ဆွေသစ်တွေနဲ့လည်း ဆုံတွေ့ရင်း ပျော်ရွှင်စရာ ပွဲတော်နေ့လေးကို အတူဆင်နွှဲကြမယ်။</p><a className="home-link" href="#entertainment">ဖျော်ဖြေရေးအစီအစဉ်များ ကြည့်မယ် <span aria-hidden="true">↗</span></a></div>
        <dl className="home-details"><div><dt>ကျင်းပမည့်ရက်</dt><dd>{EVENT.date}</dd></div><div><dt>ကျင်းပမည့်အချိန်</dt><dd>{EVENT.time}</dd></div></dl>
      </section>

      <section className="home-location home-block" aria-labelledby="location-title">
        <div className="home-location-art" aria-hidden="true"><svg viewBox="0 0 200 140" fill="none"><ellipse cx="100" cy="110" rx="70" ry="18"/><ellipse cx="100" cy="110" rx="44" ry="10"/><path d="M100 110s35-37 35-65a35 35 0 0 0-70 0c0 28 35 65 35 65Z"/><circle cx="100" cy="45" r="12"/></svg></div>
        <div><span className="eyebrow">02 / ဒီနေရာလေးမှာ ဆုံကြမယ်</span><h2 id="location-title">တို့အားလုံး <em>ဆုံစည်းရာ။</em></h2><h3>{EVENT.venue}</h3><p>GUSTO College ရဲ့ Junction Square Campus၊ Main Hall မှာ ဆုံတွေ့ကြမယ်။ သူငယ်ချင်းတွေနဲ့အတူ သီတင်းကျွတ်ရဲ့ နွေးထွေးမှုကို ဝေမျှရင်း အမှတ်တရသစ်တွေ ဖန်တီးကြရအောင်။</p></div>
      </section>

      <section className="home-voting home-block" aria-labelledby="voting-title">
        <div className="home-crown" aria-hidden="true"><Crown /></div><span className="eyebrow">03 / သင့်အားပေးမှုနဲ့ တောက်ပစေမယ်</span>
        <h2 id="voting-title">သင်နှစ်သက်သူကို အားပေးလို့<br/><em>သရဖူအိပ်မက် ဖြည့်ဆည်းစို့။</em></h2><p>ကိုယ့်ကိုယ်ကို ယုံကြည်မှု၊ ကြင်နာမှုနဲ့ GUSTO College ရဲ့ စည်းလုံးညီညွတ်မှုကို ဘယ်သူတွေက ထင်ဟပ်စေမလဲ။ King &amp; Queen ပြိုင်ပွဲဝင်တွေကို သိကျွမ်းပြီး သင်နှစ်သက်သူတွေကို မဲပေးအားပေးလိုက်ပါ။</p><a className="btn primary" href="#candidates">King &amp; Queen ပြိုင်ပွဲဝင်များ <span aria-hidden="true">↗</span></a><span className="home-small">ပြိုင်ပွဲဝင်တွေကို သိကျွမ်းမယ်။ နှစ်သက်သူကို ရွေးချယ်မယ်။ သင့်မဲနဲ့ အားပေးမယ်။</span>
      </section>

      <section className="home-feature home-block" aria-labelledby="lantern-title">
        <div className="home-lantern-art" aria-hidden="true"><span/><span/><span/></div>
        <div><span className="eyebrow">04 / အလင်းရောင်လေးထဲက မေတ္တာ</span><h2 id="lantern-title">မီးပုံးလေးတိုင်းမှာ<br/><em>ပုံပြင်တစ်ပုဒ် ရှိတယ်။</em></h2><p>တို့ကျောင်းသားတွေရဲ့ စိတ်ကူးစိတ်သန်းနဲ့ စေတနာတွေ ပုံဖော်ထားတဲ့ မီးပုံးလေးတွေကို ကြည့်ရှုခံစားလိုက်ပါ။ မီးပုံးလေးတစ်လုံးစီက ပွဲတော်ကို ကိုယ်ပိုင်အလင်းရောင်နဲ့ ပိုလှစေပါတယ်။</p><a className="home-link" href="#lanterns">မီးပုံးပြခန်းကို ကြည့်မယ် <span aria-hidden="true">↗</span></a></div>
      </section>

      <section className="home-feature home-wishes home-block" aria-labelledby="wishes-title">
        <div><span className="eyebrow">05 / ဆုတောင်းတွေ အလင်းနဲ့အတူ လွင့်ပါစေ</span><h2 id="wishes-title">ကောင်းကင်တစ်ခုတည်းအောက်မှာ<br/><em>ဆုတောင်းတွေ ဝေမျှစို့။</em></h2><p>မနက်ဖြန်အတွက် အိပ်မက်လေးတစ်ခု၊ ဒီနေ့အတွက် ကျေးဇူးတင်စကားတစ်ခွန်း၊ ချစ်ခင်ရသူအတွက် ဆုတောင်းလေးတစ်ပုဒ်… တို့အတူ ထွန်းညှိထားတဲ့ ကောင်းကင်ထဲမှာ သင့်ဆုတောင်းလေးကိုလည်း ဝေမျှခဲ့ပါ။</p><a className="home-link" href="#wishes">Wish Sky မှာ ဆုတောင်းမယ် <span aria-hidden="true">↗</span></a></div>
        <div className="home-wish-art" aria-hidden="true"><span>✧</span><span>✦</span><span>✧</span><img src="/art/wish-balloon.svg" alt="" loading="lazy"/></div>
      </section>

      <section className="home-coming home-block" aria-labelledby="memory-title"><span className="eyebrow">06 / အမှတ်တရအဖြစ် သိမ်းထားမယ်</span><h2 id="memory-title">ဒီနေ့ရဲ့ ပျော်ရွှင်မှုတွေက<br/><em>မနက်ဖြန်ရဲ့ အမှတ်တရ။</em></h2><p>အပြုံးတွေ၊ သူငယ်ချင်းသံယောဇဉ်တွေနဲ့ ပြန်တွေးတိုင်း ကြည်နူးရမယ့် အခိုက်အတန့်လေးတွေကို ဒီနေရာမှာ သိမ်းဆည်းထားမယ်။</p><a className="home-link" href="#memory-gallery">Memory Photo gallery ↗</a></section>
      <section className="home-coming home-developers home-block" aria-labelledby="developer-title"><span className="eyebrow">07 / အလင်းရောင်နောက်က ဖန်တီးသူများ</span><h2 id="developer-title">တို့ရဲ့ GUSTO College အတွက်<br/><em>စေတနာနဲ့ ဖန်တီးထားပါတယ်။</em></h2><p>ပွဲတော်ရဲ့ ပျော်ရွှင်မှုတွေကို ဒီဝက်ဘ်ဆိုက်ကနေ ဝေမျှနိုင်ဖို့ စိတ်အားထက်သန်စွာ ဖန်တီးပေးထားတဲ့ အဖွဲ့နဲ့ မိတ်ဆက်ပေးပါမယ်။</p><a className="home-link" href="#developers">Meet the developers <span aria-hidden="true">↗</span></a></section>
    </div>
  </div>;
}
