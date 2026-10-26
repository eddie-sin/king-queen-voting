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

test('festival session storage persists only complete token/user sessions and announces changes', () => {
  values.clear(); changes = 0;
  const session = { token: 'student-jwt', user: { id: 'u1', email: 'student@example.test' }, ignored: 'not persisted' };
  writeStoredSession(session);
  assert.deepEqual(readStoredSession(), { token: session.token, user: session.user });
  assert.equal(JSON.parse(values.get('thadingyut_voter_session')).ignored, undefined);
  assert.equal(changes, 1);
  writeStoredSession(null);
  assert.equal(readStoredSession(), null); assert.equal(values.has('thadingyut_voter_session'), false); assert.equal(changes, 2);
});

test('festival session storage fails closed for malformed, partial or unavailable values', () => {
  for (const value of ['not json', '{}', JSON.stringify({ token: 'only-token' }), JSON.stringify({ user: { id: 'u' } })]) {
    values.set('thadingyut_voter_session', value); assert.equal(readStoredSession(), null);
  }
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readStoredSession(), null); assert.doesNotThrow(() => writeStoredSession(null));
  globalThis.localStorage = original;
});
