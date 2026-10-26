import test from 'node:test';
import assert from 'node:assert/strict';
import { readStoredSession, writeStoredSession } from '../src/hooks/useFestival.js';

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.has(key) ? values.get(key) : null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
};
let changes = 0;
globalThis.window = { dispatchEvent: event => { if (event.type === 'festival-session-change') changes++; } };

test('festival session marker stays in memory, clears legacy storage and announces changes', () => {
  values.clear(); changes = 0;
  values.set('thadingyut_voter_session', 'legacy-secret');
  const session = { token: 'opaque-session-key', user: { id: 'u1', email: 'student@gmail.com' } };
  writeStoredSession(session);
  assert.equal(readStoredSession(), session);
  assert.equal(values.has('thadingyut_voter_session'), false);
  assert.equal(changes, 1);
  writeStoredSession(null);
  assert.equal(readStoredSession(), null); assert.equal(values.has('thadingyut_voter_session'), false); assert.equal(changes, 2);
});

test('legacy localStorage data is never restored and unavailable storage does not break logout', () => {
  writeStoredSession(null);
  for (const value of ['not json', '{}', JSON.stringify({ token: 'old-jwt', user: { id: 'u' } })]) values.set('thadingyut_voter_session', value);
  assert.equal(readStoredSession(), null);
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readStoredSession(), null); assert.doesNotThrow(() => writeStoredSession(null));
  globalThis.localStorage = original;
});
