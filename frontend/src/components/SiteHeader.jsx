import { useLanguage, useT } from '../i18n/Language.jsx';
import { useEffect } from 'react';
import { Brand, UserIcon } from '../components.jsx';

export function SiteHeader({
  items,
  route,
  session,
  menuOpen,
  setMenuOpen,
  onLogin,
  onRegister,
  onSignOut,
}) {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  useEffect(() => {
    if (!menuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = event => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, setMenuOpen]);

  return (
    <header className={`site-header ${menuOpen ? 'menu-is-open' : ''}`}>
      <div className="site-header-inner">
        <a
          className="brand-link"
          href="#home"
          aria-label={t("Thadingyut Festival of Lights")}
          onClick={() => setMenuOpen(false)}
        >
          <Brand />
        </a>

        <nav className="site-nav" aria-label={t("Main navigation")}>
          {items.map(item => {
            const active = item.match.includes(route);
            return (
              <a
                key={item.id}
                href={item.href}
                className={`nav-tab ${item.featured ? 'is-featured' : ''} ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {item.featured && (
                  <span className="nav-crown" aria-hidden="true">
                    ♔
                  </span>
                )}
                <span>{t(item.label)}</span>
              </a>
            );
          })}
        </nav>

        <div className="header-actions">
          <button
            type="button"
            className="language-toggle"
            lang={language === 'my' ? 'en' : 'my'}
            aria-label={language === 'my' ? 'Switch to English' : 'မြန်မာဘာသာ ပြောင်းမယ်'}
            onClick={() => setLanguage(language === 'my' ? 'en' : 'my')}
          >
            <span aria-hidden="true">◎</span> {language === 'my' ? 'English' : 'မြန်မာ'}
          </button>
          {session ? (
            <a
              href="#account"
              className={`account-button is-logged-in ${route === 'account' ? 'is-active' : ''}`}
              aria-current={route === 'account' ? 'page' : undefined}
              aria-label={t("Account and my choices")}
              title={t(session.user?.email || 'Account')}
              onClick={() => setMenuOpen(false)}
            >
              <span className="account-icon-wrap" aria-hidden="true">
                <UserIcon />
              </span>
              <span className="account-label">{t("Account")}</span>
            </a>
          ) : (
            <button
              type="button"
              className="account-button"
              onClick={() => {
                setMenuOpen(false);
                onLogin();
              }}
              aria-label={t("Sign in")}
            >
              <span className="account-icon-wrap" aria-hidden="true">
                <UserIcon />
              </span>
              <span className="account-label">{t("Sign in")}</span>
            </button>
          )}

          <button
            type="button"
            className={`menu-toggle-btn ${menuOpen ? 'is-open' : ''}`}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-drawer"
            aria-label={t(menuOpen ? 'Close navigation menu' : 'Open navigation menu')}
            onClick={() => setMenuOpen(v => !v)}
          >
            <span className="menu-toggle-bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <>
          <div
            className="mobile-nav-backdrop"
            aria-hidden="true"
            onClick={() => setMenuOpen(false)}
          />
          <div
            id="mobile-nav-drawer"
            className="mobile-nav-drawer"
            role="dialog"
            aria-label={t("Site navigation")}
          >
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
                      {item.featured && (
                        <span className="nav-crown" aria-hidden="true">
                          ♔
                        </span>
                      )}
                      <span>{t(item.label)}</span>
                    </div>
                    <small>{t(item.hint)}</small>
                  </a>
                );
              })}
            </div>
            <div className="mobile-nav-footer">
              {session ? (
                <div className="mobile-account-bar">
                  <div className="mobile-account-user">
                    <span className="account-icon-wrap" aria-hidden="true">
                      <UserIcon />
                    </span>
                    <div>
                      <span className="eyebrow">{t("SIGNED IN AS")}</span>
                      <strong>{session.user?.email}</strong>
                    </div>
                  </div>
                  <div className="mobile-account-actions">
                    <a
                      className="btn primary"
                      href="#account"
                      onClick={() => setMenuOpen(false)}
                    >{t("Account & Choices")}</a>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        setMenuOpen(false);
                        onSignOut();
                      }}
                    >{t("Sign out")}</button>
                  </div>
                </div>
              ) : (
                <div className="mobile-account-bar">
                  <p>{t("Sign in to view your account details and manage your King & Queen choices.")}</p>
                  <div className="mobile-account-actions">
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => {
                        setMenuOpen(false);
                        onLogin();
                      }}
                    >{t("Sign in")}</button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        setMenuOpen(false);
                        onRegister();
                      }}
                    >{t("Create account")}</button>
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
