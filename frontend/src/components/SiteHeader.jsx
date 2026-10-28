import { Brand, UserIcon } from '../components.jsx';
import DeveloperCredits from './DeveloperCredits.jsx';

export function SiteHeader({ items, route, session, menuOpen, setMenuOpen, onLogin, onRegister, onSignOut }) {
  return (
    <header className={`site-header ${menuOpen ? 'menu-is-open' : ''}`}>
      <div className="site-header-inner">
        <a className="brand-link" href="#home" aria-label="Thadingyut Festival of Lights" onClick={() => setMenuOpen(false)}><Brand/></a>

        <nav className="site-nav" aria-label="Main navigation">
          {items.map(item => {
            const active = item.match.includes(route);
            return (
              <a
                key={item.id}
                href={item.href}
                className={`nav-tab ${item.featured ? 'is-featured' : ''} ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {item.featured && <span className="nav-crown" aria-hidden="true">♔</span>}
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="header-actions">
          <DeveloperCredits pageKey={route} items={items} />
          {session ? (
            <a
              href="#account"
              className={`account-button is-logged-in ${route === 'account' ? 'is-active' : ''}`}
              aria-current={route === 'account' ? 'page' : undefined}
              aria-label="Account and my choices"
              title={session.user?.email || 'Account'}
              onClick={() => setMenuOpen(false)}
            >
              <span className="account-icon-wrap" aria-hidden="true"><UserIcon /></span>
              <span className="account-label">Account</span>
            </a>
          ) : (
            <button
              type="button"
              className="account-button"
              onClick={() => { setMenuOpen(false); onLogin(); }}
              aria-label="Sign in"
            >
              <span className="account-icon-wrap" aria-hidden="true"><UserIcon /></span>
              <span className="account-label">Sign in</span>
            </button>
          )}

          <button
            type="button"
            className={`menu-toggle-btn ${menuOpen ? 'is-open' : ''}`}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-drawer"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setMenuOpen(v => !v)}
          >
            <span className="menu-toggle-bars" aria-hidden="true">
              <i /><i /><i />
            </span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <>
          <div className="mobile-nav-backdrop" aria-hidden="true" onClick={() => setMenuOpen(false)} />
          <div id="mobile-nav-drawer" className="mobile-nav-drawer" role="dialog" aria-label="Site navigation">
            <div className="mobile-nav-grid">
              {items.map(item => {
                const active = item.match.includes(route);
                return (
                  <a
                    key={item.id}
                    href={item.href}
                    className={`mobile-nav-card ${item.featured ? 'is-featured' : ''} ${active ? 'is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <div className="mobile-nav-title">
                      {item.featured && <span className="nav-crown" aria-hidden="true">♔</span>}
                      <span>{item.label}</span>
                    </div>
                    <small>{item.hint}</small>
                  </a>
                );
              })}
            </div>
            <div className="mobile-nav-footer">
              {session ? (
                <div className="mobile-account-bar">
                  <div className="mobile-account-user">
                    <span className="account-icon-wrap" aria-hidden="true"><UserIcon /></span>
                    <div>
                      <span className="eyebrow">SIGNED IN AS</span>
                      <strong>{session.user?.email}</strong>
                    </div>
                  </div>
                  <div className="mobile-account-actions">
                    <a className="btn primary" href="#account" onClick={() => setMenuOpen(false)}>Account &amp; Choices</a>
                    <button type="button" className="btn secondary" onClick={() => { setMenuOpen(false); onSignOut(); }}>Sign out</button>
                  </div>
                </div>
              ) : (
                <div className="mobile-account-bar">
                  <p>Sign in to view your account details and manage your King &amp; Queen choices.</p>
                  <div className="mobile-account-actions">
                    <button type="button" className="btn primary" onClick={() => { setMenuOpen(false); onLogin(); }}>Sign in</button>
                    <button type="button" className="btn secondary" onClick={() => { setMenuOpen(false); onRegister(); }}>Create account</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </header>
  );
}
