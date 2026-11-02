import { useEffect, useRef, useState } from 'react';
import { FestivalMotion } from './FestivalMotion.jsx';
import ConnectedUpload from './ConnectedUpload.jsx';
import AllMemories from './AllMemories.jsx';
import MyMemories from './MyMemories.jsx';
import { MEMORY_TABS } from './config.js';
import './memory.css';

export default function MemoryPhoto({ tab, api, onRequireLogin }) {
  const [activeTab, setActiveTab] = useState(tab);
  const main = useRef(null);
  useEffect(() => setActiveTab(tab), [tab]);
  useEffect(() => {
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [activeTab]);
  const currentTab = activeTab || tab || 'all';
  return (
    <div className="mp-demo">
      <FestivalMotion />
      <a className="mp-skip" href="#mp-content" onClick={event => { event.preventDefault(); main.current?.focus(); }}>
        Skip to memories
      </a>
      <div className="mp-sparkles" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <span key={index} style={{ '--i': index }}>✦</span>)}</div>
      <main className="mp-main" id="mp-content" ref={main} tabIndex="-1">
        <div className="mp-topline">
          <a className="mp-wordmark" href="#memory-gallery"><span>✦</span> Memory Photo</a>
          <nav className="mp-tabs" aria-label="Memory Photo pages">
            {MEMORY_TABS.map(item => <a href={item.hash} key={item.id} aria-current={currentTab === item.id ? 'page' : undefined} onClick={() => setActiveTab(item.id)}>{item.label}</a>)}
          </nav>
        </div>
        <div className="mp-demo-note">
          <span className="mp-live-dot" />
          {currentTab === 'all' ? 'THE COLLEGE KEEPSAKE' : currentTab === 'mine' ? 'YOUR MEMORIES' : 'YOUR LITTLE LIGHTS'}
          <span>{currentTab === 'all' ? 'Approved memories from our festival' : currentTab === 'mine' ? 'Your private submission history · only approved photos are public' : 'Student submissions · reviewed before sharing'}</span>
        </div>
        {currentTab === 'all' && <AllMemories api={api} onRequireLogin={onRequireLogin} />}
        {currentTab === 'mine' && <MyMemories api={api} />}
        {currentTab === 'upload' && <ConnectedUpload api={api} />}
        <div className="mp-endmark" aria-hidden="true"><span />✦ <em>the moments make us</em> ✦<span /></div>
      </main>
      <footer className="mp-footer"><span>GUSTO College · Thadingyut 2026</span><span>Made of light. Made of us.</span><small>Connected Memory Photo · Original design &amp; artwork preserved</small></footer>
    </div>
  );
}
