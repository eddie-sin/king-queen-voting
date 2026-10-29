import { useT } from '../i18n/Language.jsx';
import { useEffect, useRef, useState } from 'react';
import male from '../../developers/dev male.jpg';
import female from '../../developers/dev female.jpg';
import '../developers.css';

// Roles and overlapping team memberships are transcribed from developers/TEAM.txt.
const people = [
  ['Thant Sin Aung', 'M', ['System Architect', 'Team Lead']],
  ['Shun Lak Thaw Tar', 'F', ['Backend Lead']],
  ['Kaung Zaw Hein', 'M', ['QA']],
  ['Zin Zin Pwint Han', 'F', ['Frontend Lead', 'UI/UX Designer', 'Frontend Developer']],
  ['Lin Khant Kyaw', 'M', ['UI/UX Designer', 'Frontend Developer']],
  ['Shin Thant', 'M', ['UI/UX Designer']],
  ['Pwint Phyu Soe', 'F', ['UI/UX Designer']],
  ['Hnin Thiri', 'F', ['Backend Developer']],
  ['Aung Myint Myat', 'M', ['Backend Developer']],
  ['Kaung Myat', 'M', ['Backend Developer']],
  ['No Ko', 'M', ['Backend Developer']],
].map(([name, gender, roles], id) => ({ id, name, roles, photo: gender === 'F' ? female : male }));
const teams = [
  { name: 'Managing Team', mark: '01', color: '#e9bd75', members: [0, 1, 2, 10], description: 'Bringing the people, plans, and pieces together.', note: 'Project Manager · Thant Sin Aung' },
  { name: 'UI/UX Team', mark: '02', color: '#d8a4cf', members: [3, 4, 5, 6], description: 'Giving our festival a visual language and a welcoming experience.' },
  { name: 'Frontend Team', mark: '03', color: '#8dc7d2', members: [2, 3, 8], description: 'Bringing the festival experience to your screen.' },
  { name: 'Backend Team', mark: '04', color: '#abb6ee', members: [0, 1, 10, 7, 9], description: 'Connecting the pieces behind the festival experience.' },
  { name: 'QA Team', mark: '05', color: '#b7cea0', members: [2, 0], description: 'Looking closely at the details, from the first click to the last.' },
];
const positions = [[37,17,17],[59,13,14],[78,27,15],[19,31,16],[43,42,19],[65,40,13],[85,53,14],[21,61,14],[46,71,16],[68,68,17],[30,85,12]];
const teamPositions = [[17,10],[20,46],[61,88],[83,78],[82,8]];

export default function DevelopersPage() {
  const t = useT();
  const [selection, setSelection] = useState(null);
  const [closing, setClosing] = useState(false);
  const dialog = useRef(null);
  const trigger = useRef(null);
  const timer = useRef(null);
  const returnTeam = useRef(null);
  const open = (next, event) => {
    trigger.current = event.currentTarget;
    returnTeam.current = null;
    const rect = event.currentTarget.getBoundingClientRect();
    dialog.current.style.setProperty('--origin-x', `${rect.left + rect.width / 2 - innerWidth / 2}px`);
    dialog.current.style.setProperty('--origin-y', `${rect.top + rect.height / 2 - innerHeight / 2}px`);
    setSelection(next);
    setClosing(false);
    dialog.current.showModal();
  };
  const close = () => {
    if (closing) return;
    setClosing(true);
    timer.current = setTimeout(() => {
      dialog.current?.close();
      setSelection(null);
      setClosing(false);
      trigger.current?.focus();
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320);
  };
  useEffect(() => {
    if (!selection) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [Boolean(selection)]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const person = selection?.type === 'person' ? people[selection.id] : null;
  const team = selection?.type === 'team' ? teams[selection.id] : null;
  const switchTo = next => { setSelection(next); dialog.current.querySelector('.dev-back')?.focus(); };

  return <section className="developers-page" aria-labelledby="developers-title">
    <div className="dev-atmosphere" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ left: `${(i * 31 + 3) % 100}%`, top: `${(i * 17) % 100}%`, animationDelay: `${-i * .7}s` }} />)}<span className="dev-lantern dev-lantern-left"/><span className="dev-lantern dev-lantern-right"/></div>
    <div className="dev-intro"><a className="dev-home" href="#home">{t("← Festival home")}</a><span className="eyebrow">{t("THE PEOPLE BEHIND THE GLOW")}</span><h1 id="developers-title">{t("Many minds.")}<br/>{t("One ")}<em>{t("little light.")}</em></h1><p>{t("Meet the developers who brought our")}<br className="dev-desktop-break"/>{t(" Thadingyut celebration to life.")}</p><div className="dev-count"><strong>11</strong><span>{t("creators")}</span><i/><strong>05</strong><span>{t("teams")}</span></div><span className="dev-instruction">{t("Choose a face. Discover a story.")}<br/>{t("Choose a team. Meet the minds.")}</span></div>
    <div className="dev-constellation" aria-label={t("Meet all 11 developers and five teams")}>
      <div className="dev-orbit dev-orbit-one" aria-hidden="true"/><div className="dev-orbit dev-orbit-two" aria-hidden="true"/>
      <span className="dev-center-star" aria-hidden="true">✧</span>
      {people.map((p, i) => <div className="dev-node" key={p.id} style={{ '--x': `${positions[i][0]}%`, '--y': `${positions[i][1]}%`, '--size': `${positions[i][2]}%`, '--delay': `${-i * .8}s`, '--tint': teams[i % 5].color }}><button className="dev-portrait" aria-label={t(`Meet ${p.name}`)} onClick={e => open({ type: 'person', id: p.id }, e)}><img src={p.photo} alt=""/><span className="dev-portrait-shade"/><span className="dev-person-name">{p.name}<small>{t(p.roles[0])}</small></span><span className="dev-plus" aria-hidden="true">↗</span></button></div>)}
      {teams.map((group, i) => <button className="dev-team-orb" key={group.name} style={{ '--x': `${teamPositions[i][0]}%`, '--y': `${teamPositions[i][1]}%`, '--tint': group.color, '--delay': `${-i}s` }} onClick={e => open({ type: 'team', id: i }, e)}><small>{group.mark} / {group.members.length}{t(" PEOPLE")}</small><strong>{t(group.name)}</strong><span aria-hidden="true">↗</span></button>)}
      <span className="dev-cluster-caption">{t("A LITTLE CODE. A LOT OF HEART.")}</span>
    </div>
    <div className="dev-bottom"><span>{t("DEVELOPERS / GUSTO COLLEGE")}</span><p>{t("Made together. To celebrate together.")}</p><span>{t("THADINGYUT · 2026")}</span></div>
    <dialog ref={dialog} className={`dev-dialog ${closing ? 'is-closing' : ''}`} aria-labelledby="dev-spotlight-title" onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
      {selection && <div className="dev-spotlight" key={`${selection.type}-${selection.id}`}>
        <div className="dev-dialog-toolbar"><button className="dev-back" onClick={person && returnTeam.current !== null ? () => { const id = returnTeam.current; returnTeam.current = null; switchTo({ type: 'team', id }); } : close}>← {t(person && returnTeam.current !== null ? 'Back to team' : 'Back to everyone')}</button><span>{t("BEHIND THE GLOW")}</span><button className="dev-close" onClick={close} aria-label={t("Close spotlight")}>×</button></div>
        {person ? <div className="dev-solo"><div className="dev-solo-copy"><span className="eyebrow">{t("MEET THE DEVELOPER / ")}{String(person.id + 1).padStart(2, '0')}</span><h2 id="dev-spotlight-title">{person.name}</h2><div className="dev-roles">{person.roles.map(role => <span key={role}>{t(role)}</span>)}</div><p>{t("One of the minds behind our")}<br/>{t("Thadingyut celebration.")}</p><span className="dev-solo-star" aria-hidden="true">✧</span></div><div className="dev-solo-photo"><img src={person.photo} alt={person.name}/><span>{t("GUSTO COLLEGE · THADINGYUT 2026")}</span></div><aside className="dev-solo-teams"><span className="eyebrow">{t("PART OF THE TEAM")}</span>{teams.map((group, i) => group.members.includes(person.id) && <button key={group.name} onClick={() => { returnTeam.current = null; switchTo({ type: 'team', id: i }); }}>{t(group.name)}<span>↗</span></button>)}</aside></div> : <div className="dev-team-view" style={{ '--tint': team.color }}><div className="dev-team-heading"><div><span className="eyebrow">{t("THE COLLECTIVE / ")}{team.mark}</span><h2 id="dev-spotlight-title">{t(team.name)}</h2></div><p>{t(team.description)}{team.note && <small>{t(team.note)}</small>}</p></div><div className="dev-team-members">{team.members.map(id => <button key={id} onClick={() => { returnTeam.current = selection.id; switchTo({ type: 'person', id }); }}><div><img src={people[id].photo} alt=""/><span aria-hidden="true">↗</span></div><h3>{people[id].name}</h3><p>{people[id].roles.map(role => t(role)).join(' · ')}</p></button>)}</div><span className="dev-team-footnote">{team.members.length}{t(" PEOPLE · ONE SHARED CELEBRATION")}</span></div>}
      </div>}
    </dialog>
  </section>;
}
