import test from 'node:test';
import assert from 'node:assert/strict';
import { isMemoryDemoHash, resumeAfterLogin, shouldShowGuestLanding, shouldShowSessionCheckShell, shouldShowSessionLoader } from '../src/authRoutePolicy.js';
import { withSessionTimeout } from '../src/hooks/useFestival.js';
import { readStoredSession, writeStoredSession } from '../src/authSession.js';

const sessionValues = new Map();
globalThis.localStorage = {
  getItem: key => sessionValues.get(key) || null,
  setItem: (key, value) => sessionValues.set(key, value),
  removeItem: key => sessionValues.delete(key),
};
globalThis.window = { dispatchEvent() {} };

test('guest routes stay behind the auth landing until session restoration is ready', () => {
  assert.equal(shouldShowGuestLanding({ sessionReady: false, session: null }), false);
  assert.equal(shouldShowGuestLanding({ sessionReady: true, session: null }), true);
  assert.equal(shouldShowGuestLanding({ sessionReady: true, session: { token: 'session' } }), false);
  assert.equal(shouldShowGuestLanding({ sessionReady: true, session: null, fixtureMode: true }), false);
});

test('stored session markers show only the navigation shell until server verification', () => {
  assert.equal(shouldShowSessionLoader({ sessionReady: false, session: { token: 'existing' } }), false);
  assert.equal(shouldShowSessionCheckShell({ sessionReady: false, session: { token: 'existing' } }), true);
  assert.equal(shouldShowSessionCheckShell({ sessionReady: true, session: { token: 'existing' } }), false);
  assert.equal(shouldShowSessionLoader({ sessionReady: false, session: null }), true);
  assert.equal(shouldShowSessionLoader({ sessionReady: true, session: null }), false);
});

test('memory demo hashes are explicitly separated from real memory routes', () => {
  assert.equal(isMemoryDemoHash('#memory-gallery-demo'), true);
  assert.equal(isMemoryDemoHash('#memory-upload'), false);
  assert.equal(isMemoryDemoHash('#MEMORY-GALLERY-DEMO'), true);
});

test('session checks time out instead of leaving a loading screen forever', async () => {
  await assert.rejects(withSessionTimeout(new Promise(() => {}), 10), error => error.code === 'SESSION_TIMEOUT');
});

test('login resumes the intended hash and safely defaults to Home', () => {
  assert.equal(resumeAfterLogin({ returnTo: '#memory-gallery', hasSession: true }), '#memory-gallery');
  assert.equal(resumeAfterLogin({ returnTo: 'javascript:bad', hasSession: true }), '#home');
  assert.equal(resumeAfterLogin({ returnTo: '#home', hasSession: false }), null);
});

test('logout clears the in-memory session marker', () => {
  writeStoredSession({ token: 'temporary', user: { id: 'student' } });
  assert.ok(readStoredSession());
  writeStoredSession(null);
  assert.equal(readStoredSession(), null);
});
