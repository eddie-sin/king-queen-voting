import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { createApi } from './api.js';
import './style.css';
import './festival.css';

async function mount() {
  // Vite removes this branch and the fixture import from a production build.
  const fixtureMode = import.meta.env.DEV && import.meta.env.VITE_USE_FIXTURES === 'true';
  const api = fixtureMode ? (await import('./fixtures/fixtureApi.js')).createFixtureApi({ scenario: import.meta.env.VITE_FIXTURE_SCENARIO || 'open' }) : createApi();
  createRoot(document.getElementById('root')).render(<App api={api} fixtureMode={fixtureMode}/>);
}
mount();

import './source-match.css';
