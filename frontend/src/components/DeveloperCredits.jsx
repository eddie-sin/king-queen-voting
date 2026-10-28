import { useRef } from 'react';
import './developer-credits.css';

const pageNames = {
  home: 'Home',
  candidates: 'King & Queen',
  king: 'King Candidates',
  queen: 'Queen Candidates',
  results: 'Results',
  lanterns: 'Lanterns',
  wishes: 'Wish Sky',
  'memory-gallery': 'Memory Gallery',
  'my-memories': 'My Memories',
  'memory-upload': 'Photo Upload',
  entertainment: 'Entertainment',
  developers: 'Developers',
  privacy: 'Privacy',
  account: 'Account & My Choices',
};

// Page contributors are based on Git history for each page and its connected features.
// Lin's UI and frontend credits are included on all voter pages except Home as requested.
const pageCredits = {
  home: {
    'UI Design': ['Zin Zin Pwint Han', 'Shin Thant', 'Pwint Phyu Soe'],
    Frontend: ['Thant Sin Aung', 'Zin Zin Pwint Han', 'Kaung Zaw Hein', 'Aung Myint Myat'],
    Backend: ['Thant Sin Aung', 'Shun Lak Thaw Tar', 'Hnin Thiri', 'Aung Myint Myat', 'Kaung Myat', 'No Ko'],
  },
  candidates: { 'UI Design': ['Lin Khant Kyaw'], Frontend: ['Lin Khant Kyaw', 'Niikolaiii', 'Thant Sin Aung'], Backend: ['Thant Sin Aung', 'No Ko', 'Aung Myint Myat'] },
  king: { 'UI Design': ['Lin Khant Kyaw'], Frontend: ['Lin Khant Kyaw', 'Niikolaiii', 'Thant Sin Aung'], Backend: ['Thant Sin Aung', 'No Ko', 'Aung Myint Myat'] },
  queen: { 'UI Design': ['Lin Khant Kyaw'], Frontend: ['Lin Khant Kyaw', 'Niikolaiii', 'Thant Sin Aung'], Backend: ['Thant Sin Aung', 'No Ko', 'Aung Myint Myat'] },
  results: { 'UI Design': ['Lin Khant Kyaw'], Frontend: ['Lin Khant Kyaw', 'Thant Sin Aung'], Backend: ['Thant Sin Aung'] },
  lanterns: { 'UI Design': ['Lin Khant Kyaw'], Frontend: ['Lin Khant Kyaw', 'Aung Myint Myat', 'Thant Sin Aung'], Backend: ['Aung Myint Myat', 'Thant Sin Aung'] },
  wishes: { 'UI Design': ['Lin Khant Kyaw'], Frontend: ['Lin Khant Kyaw', 'Niikolaiii'], Backend: ['Thant Sin Aung', 'Niikolaiii', 'kittyplush'] },
  'memory-gallery': { 'UI Design': ['Lin Khant Kyaw'], Frontend: ['Lin Khant Kyaw', 'Shun Lak Thaw Tar'], Backend: ['Shun Lak Thaw Tar', 'Thant Sin Aung'] },
  'my-memories': { 'UI Design': ['Lin Khant Kyaw'], Frontend: ['Lin Khant Kyaw', 'Shun Lak Thaw Tar'], Backend: ['Shun Lak Thaw Tar', 'Thant Sin Aung'] },
  'memory-upload': { 'UI Design': ['Lin Khant Kyaw'], Frontend: ['Lin Khant Kyaw', 'Shun Lak Thaw Tar'], Backend: ['Shun Lak Thaw Tar', 'Thant Sin Aung'] },
  entertainment: { 'UI Design': ['Lin Khant Kyaw'], Frontend: ['Lin Khant Kyaw', 'Thant Sin Aung'], Backend: [] },
  developers: { 'UI Design': ['Lin Khant Kyaw'], Frontend: ['Lin Khant Kyaw', 'Thant Sin Aung'], Backend: [] },
  privacy: { 'UI Design': ['Lin Khant Kyaw'], Frontend: ['Lin Khant Kyaw', 'Thant Sin Aung'], Backend: [] },
  account: { 'UI Design': ['Lin Khant Kyaw'], Frontend: ['Lin Khant Kyaw', 'Niikolaiii', 'Thant Sin Aung'], Backend: ['Thant Sin Aung', 'Shun Lak Thaw Tar', 'No Ko'] },
};

function TeamIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3.5 19v-1.2A4.8 4.8 0 0 1 8.3 13h1.4a4.8 4.8 0 0 1 4.8 4.8V19" /><path d="M16 5.4a3 3 0 0 1 0 5.8M17 13.2a4.8 4.8 0 0 1 3.5 4.6V19" /></svg>;
}

export default function DeveloperCredits({ pageKey, items = [] }) {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const close = () => dialog.current?.close();
  const pageName = pageNames[pageKey] || items.find(item => item.match.includes(pageKey))?.label || 'Festival';
  const roles = pageCredits[pageKey] || pageCredits.home;
  const roleDetails = {
    'UI Design': { note: 'Page look & visual design', mark: '✧' },
    Frontend: { note: 'Page layout & interactions', mark: 'JS' },
    Backend: { note: 'Page data & server features', mark: '⌘' },
  };
  const groups = Object.entries(roles)
    .filter(([, people]) => people.length > 0)
    .map(([title, people]) => ({ title, people, ...roleDetails[title] }));
  const contributorCount = new Set(groups.flatMap(group => group.people)).size;

  return (
    <>
      <button type="button" className="developer-credits-trigger" aria-label="Meet the developers" title="Meet the developers" onClick={event => { trigger.current = event.currentTarget; dialog.current?.showModal(); }}>
        <TeamIcon /><span className="developer-credits-trigger-label">Developers</span>
      </button>
      <dialog ref={dialog} className="developer-credits-dialog" aria-labelledby="developer-credits-title" onClose={() => trigger.current?.focus()} onClick={event => { if (event.target === event.currentTarget) close(); }}>
        <section className="developer-credits-card">
          <div className="developer-credits-topline">
            <span className="developer-credits-emblem" aria-hidden="true"><i>✧</i></span>
            <span className="developer-credits-kicker">PAGE CREDITS <i>✦</i> {pageName.toUpperCase()}</span>
            <button type="button" className="developer-credits-close" onClick={close} aria-label="Close developers popup">×</button>
          </div>
          <header className="developer-credits-heading">
            <span className="developer-credits-eyebrow"><i /> THE PEOPLE BEHIND THIS PAGE <i /></span>
            <h2 id="developer-credits-title">Made with care,<br /><em>page by page.</em></h2>
            <p>People credited for the {pageName} page.</p>
            <div className="developer-credits-count"><span>✦</span> {contributorCount} {contributorCount === 1 ? 'CONTRIBUTOR' : 'CONTRIBUTORS'} <i /> {groups.length} {groups.length === 1 ? 'ROLE' : 'ROLES'} <span>✦</span></div>
          </header>
          <div className={`developer-credits-groups developer-credits-groups-${groups.length}`}>
            {groups.map((group, index) => (
              <section className={`developer-credits-group developer-credits-group-${index + 1}`} key={group.title} aria-labelledby={`developer-credits-group-${index}`}>
                <div className="developer-credits-group-head">
                  <span className="developer-credits-group-mark" aria-hidden="true">{group.mark}</span>
                  <div className="developer-credits-group-title"><span className="developer-credits-number">0{index + 1} / TEAM</span><h3 id={`developer-credits-group-${index}`}>{group.title}</h3><p>{group.note}</p></div>
                </div>
                <ul>{group.people.map(person => <li key={person}><span className="developer-credits-initials" aria-hidden="true">{person.split(' ').map(part => part[0]).slice(0, 2).join('')}</span><span>{person}</span></li>)}</ul>
              </section>
            ))}
          </div>
          <p className="developer-credits-footer"><span /> MADE WITH HEART, LIT TOGETHER <span /></p>
        </section>
      </dialog>
    </>
  );
}
