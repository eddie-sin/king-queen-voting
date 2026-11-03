import { useRef, useState } from 'react';
import './entertainment-agenda.css';

const agenda = [
  { no: '1', description: 'ကန်တော့ခံဆရာကြီးဆရာမကြီးများစင်ပေါ်တွင်နေရာယူခြင်း  ။', time: '9:30 Am', duration: '15 min' },
  { no: '2', description: 'အခမ်းအနားအစီအစဉ်များကို စတင်ဖတ်ကြားခြင်း။', time: '9:45 Am', duration: '5min' },
  { no: '3', description: 'GUSTO College ၏ ကျောင်းသူ ကျောင်းသားများမှ ဆရာ/ဆရာမများအားဂါဝရတရားရှေ့ထားဦးခိုက်ကန်တော့ခြင်း ။', time: '9:50Am', duration: '10min' },
  { no: '4', description: 'ကန်တော့ခံဆရာကြီး ဆရာမကြီးများမှ ဆုံးမ ဩဝါဒစကားများ ပြန်လည်ပြောကြားခြင်း ။', time: '10:00 Am', duration: '20min' },
  { no: '5', description: 'Dance Club မှ ကျောင်းသား ကျောင်းသူများက ဆီမီးအကဖြင့် ပူဇော်ကပြဖျော်ဖြေခြင်း ။', time: '10:20Am', duration: '10min', entertainment: true },
  { no: '6', description: 'ကန်တော့ခံ ဆရာ / ဆရာမများ ခန်းမအတွင်းမှ ပြန်လည်ထွက်ခွါခြင်း။', time: '10:30 Am', duration: '10min' },
  { no: '7', description: 'King & Queen Candidatesများ မိတ်ဆက်ခြင်းနှင့် များLanterns များအား ပြသခြင်း။', time: '10:40 Am', duration: '20min' },
  { no: '8', description: 'ဖျော်ဖြေရေး နံနက်ပိုင်းအစီအစဉ်များ စတင်ခြင်း ။', time: '11:00 Am', duration: '1.5 hr', entertainment: true },
  { no: '9', description: 'စတုဒီသာ လှူဒါန်ခြင်း ။', time: '12:30 Pm', duration: '30min' },
  { no: '10', description: 'ဖျော်ဖြေရေးအစီအစဉ် ဒုတိယအပိုင်းအား စတင်ခြင်း။', time: '1:00 Pm', duration: '2hr', entertainment: true },
  { no: '11', description: 'King and Queen အား ရွေးချယ်ဆုပေးခြင်း ။', time: '3:00 Pm', duration: '30min' },
  { no: '12', description: 'အခမ်းအနားအောင်မြင်စွာပြီိးဆုံးကြောင်း ကြေငြာခြင်း။', time: '3:30 Pm', duration: '' },
];

const songs = [
  { name: 'ဆီမီး', duration: '5 Min' },
  { name: 'King & Queen X Lantern', duration: '-' },
  { name: 'သီတင်းကျွတ်မီးထွန်းပွဲတော်, ပင်စိမ်းသီးပိုးထိုး', duration: '5 Min' },
  { name: 'မမြင့်', duration: '5 Min' },
  { name: 'ဥ◌ီးရွှေရိုး နှင့် ဒေါ်မိုး', duration: '6 Min' },
  { name: 'ပျော်တော်ဆက်', duration: '5 Min' },
  { name: 'ဘားအံသူ', duration: '3 Min' },
  { name: 'ချစ်ကံဆိုး', duration: '5 Min' },
  { name: 'Band', duration: '15 Min' },
  { name: 'ရှမ်းအက + တိဘက်', duration: '3 Min' },
  { name: 'Band', duration: '15 Min' },
  { name: 'King & Queen X Lantern', duration: '-' },
  { name: 'BREAK (Nate Ban Zayy)', duration: '' },
  { name: 'ပြဇာတ်', duration: '25 Min' },
  { name: 'Indian Dance', duration: '5 Min' },
  { name: 'မင်းရဲ့အရိပ်ကလေး', duration: '5 Min' },
  { name: 'ကြယ်ပန်း', duration: '5 Min' },
  { name: 'မောင့်ချစ်သူ', duration: '5 Min' },
  { name: 'ဆောင်းတွင်းနွေ', duration: '5 Min' },
  { name: 'Jennie + Lisa ( Remix )', duration: '3 Min' },
  { name: 'မြင်နေခွင့်', duration: '5 Min' },
  { name: 'အပြုံးလေး', duration: '5 Min' },
  { name: 'Kpop ( Remix )', duration: '' },
  { name: 'Mask', duration: '5 Min' },
  { name: 'လွမ်းလွန်းလို့', duration: '5 Min' },
  { name: 'လိုက်ဖက်တဲ့ဘဝ', duration: '5 Min' },
  { name: 'မသုံးမကျတဲ့ နှင်းဆီ', duration: '5 Min' },
];

const agendaTabs = [
  { id: 'main', label: 'Main Agenda', panelClass: 'agenda-panel--main' },
  { id: 'entertainment', label: 'Entertainment Agenda', panelClass: 'agenda-panel--entertainment' },
];

function AgendaTable({ rows, main = false }) {
  return (
    <div className={`agenda-table-wrap${main ? ' agenda-table-wrap--main' : ''}`}>
      <table className="agenda-table">
        <thead><tr><th scope="col">No</th><th scope="col">Description</th><th scope="col">Time</th><th scope="col">Duration</th></tr></thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={item.no} className={item.entertainment ? 'agenda-row--highlight' : ''} style={{ '--agenda-row': index }}>
              <td data-label="No"><span className="agenda-number">{item.no}</span></td>
              <td data-label="Description" className="agenda-description" lang="my">{item.description}</td>
              <td data-label="Time"><time>{item.time}</time></td>
              <td data-label="Duration">{item.duration}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EntertainmentAgenda() {
  const [activeTab, setActiveTab] = useState('main');
  const tabRefs = useRef({});
  const handleTabKeyDown = event => {
    const currentIndex = agendaTabs.findIndex(tab => tab.id === activeTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % agendaTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex + agendaTabs.length - 1) % agendaTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = agendaTabs.length - 1;
    else return;
    event.preventDefault();
    const next = agendaTabs[nextIndex];
    setActiveTab(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <section className="source-section agenda-section" aria-labelledby="agenda-title">
      <div className="agenda-frame">
        <div className="agenda-ambience" aria-hidden="true"><span className="agenda-orb" /><span className="agenda-orb agenda-orb--small" /><span className="agenda-star agenda-star--one">✦</span><span className="agenda-star agenda-star--two">✧</span><span className="agenda-star agenda-star--three">✦</span></div>
        <header className="agenda-header">
          <span className="agenda-crest" aria-hidden="true">✧</span>
          <h1 id="agenda-title">Thadingyut Event &amp; Paying Homage Ceremony “2026” Agenda</h1>
          <div className="agenda-event-details">
            <span>{'Date : Nov 6th 2026 (Friday)'}</span>
            <span>{'Venue: GCB (Junction Square Campus)'}</span>
          </div>
        </header>

        <div className="agenda-tabs" role="tablist" aria-label="Agenda pages">
          {agendaTabs.map(tab => (
            <button
              key={tab.id}
              ref={node => { tabRefs.current[tab.id] = node; }}
              id={`agenda-tab-${tab.id}`}
              className={`agenda-tab${activeTab === tab.id ? ' is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`agenda-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={handleTabKeyDown}
            >
              <span className="agenda-tab-icon" aria-hidden="true">{tab.id === 'main' ? '☼' : '♫'}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {agendaTabs.map(tab => (
          <div
            key={tab.id}
            id={`agenda-panel-${tab.id}`}
            className={`agenda-panel ${tab.panelClass}`}
            role="tabpanel"
            aria-labelledby={`agenda-tab-${tab.id}`}
            tabIndex={0}
            hidden={activeTab !== tab.id}
          >
            {tab.id === 'main' ? (
              <AgendaTable rows={agenda} main />
            ) : (
              <section className="agenda-song-sheet" aria-label="Song Name">
                <table className="agenda-song-table">
                  <thead><tr><th scope="col">Song Name</th><th scope="col">Duration</th></tr></thead>
                  <tbody>
                    {songs.map((song, index) => (
                      <tr key={`${index}-${song.name}`} className={song.name.startsWith('BREAK (') ? 'agenda-song-item--break' : ''} style={{ '--agenda-row': index }}>
                        <td lang="my"><span className="agenda-song-sparkle" aria-hidden="true">✧</span>{song.name}</td>
                        <td>{song.duration && <span className="agenda-song-duration">{song.duration}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        ))}
        <div className="agenda-footer-ornament" aria-hidden="true"><span />✧<span /></div>
      </div>
    </section>
  );
}
