import React from 'react';
import { createRoot } from 'react-dom/client';
import { startReleaseUpdates } from './releaseUpdates.js';
import App from './App.jsx';
import { LanguageProvider } from './i18n/Language.jsx';
import { translate } from './i18n/locale.js';
import { createApi } from './api.js';
import { createWishApi } from './wishes/wishApi.js';
import { wishBackendConfig } from './wishes/wishBackendConfig.js';
import './style.css';
import './festival.css';
import './source-match.css';
import './wishes/wish-sky.css';
import './components/music-player.css';

async function mount() {
  // Vite removes this branch and the fixture import from a production build.
  const fixtureMode =
    import.meta.env.DEV && import.meta.env.VITE_USE_FIXTURES === 'true';
  const api = fixtureMode
    ? (await import('./fixtures/fixtureApi.js')).createFixtureApi({
        scenario: import.meta.env.VITE_FIXTURE_SCENARIO || 'open',
      })
    : createApi();
  const wishApi = fixtureMode
    ? (await import('./fixtures/wishFixtureApi.js')).createWishFixtureApi({
        accountForToken: async token => (await api.me(token)).id,
      })
    : createWishApi(wishBackendConfig);

  createRoot(document.getElementById('root')).render(
    <LanguageProvider><App api={api} wishApi={wishApi} fixtureMode={fixtureMode} /></LanguageProvider>,
  );
}

mount();

if (import.meta.env.PROD) startReleaseUpdates({ localize: text => translate(text, document.documentElement.lang) });
