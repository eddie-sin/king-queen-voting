import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../src/api.js';
import './auth-fixture.js';

test('student voting uses cookies, CSRF and immutable votes with manual round/window', async () => {
  const seen = [];
  const api = createApi({ fetchImpl: async (url, options) => { seen.push({ url, ...options }); return new Response(JSON.stringify({ status: 'success', data: { votes: [] }, message: 'OK' })); } });
  await api.myVotes('marker'); await api.submit('marker', 'k1', 'king', {round:2,window:3});
  assert.deepEqual(seen.map(x => [x.method, x.url]), [['GET','/api/v1/voting/my-votes'],['POST','/api/v1/voting/submit']]);
  for (const request of seen) { assert.equal(request.headers.Authorization, undefined); assert.equal(request.cache, 'no-store'); assert.equal(request.credentials,'same-origin'); }
  assert.equal(seen[1].headers['X-CSRF-Token'],'fixture-csrf');
  assert.deepEqual(JSON.parse(seen[1].body), { candidateId:'k1', contest:'king',round:2,window:3 });
  assert.equal(api.change,undefined);assert.equal(api.remove,undefined);
});
test('unsuccessful HTTP status is rejected even with success payload', async () => {
  const api = createApi({ fetchImpl: async () => new Response(JSON.stringify({ status: 'success', message: 'Wrong key' }), { status: 401 }) });
  await assert.rejects(api.myVotes('token'), error => error instanceof ApiError && error.status === 401);
});
test('fail body, network interruption and unreadable JSON are rejected', async () => {
  const api = createApi({ fetchImpl: async () => new Response(JSON.stringify({ status: 'fail', message: 'Not open' })) });
  await assert.rejects(api.submit('marker', 'c1', 'king',{round:1,window:1}), /Not open/);
  const network = createApi({ fetchImpl: async () => { throw new TypeError('Network error'); } });
  await assert.rejects(network.submit('marker', 'c1', 'king',{round:1,window:1}), error => error.interrupted);
  const invalid = createApi({ fetchImpl: async () => new Response('not JSON') });
  await assert.rejects(invalid.submit('marker', 'c1', 'king',{round:1,window:1}), error => error.interrupted);
});
test('server messages redact accidental secret-like values from UI errors', async () => {
  const secret = 'c'.repeat(64);
  const api = createApi({ fetchImpl: async () => new Response(JSON.stringify({ status: 'fail', message: `Invalid session ${secret}` }), { status: 401 }) });
  await assert.rejects(api.myVotes('token'), error => error.message.includes('[redacted]') && !error.message.includes(secret));
});
test('settings and announced results use current public v2 response shapes', async () => {
  const seen = [];
  const responses = [
    { status: 'success', data: { controls: { registrationOpen: true, votingStatus: 'closed', announcementOpen: true, round: 2, window: 5, revision: 9 } } },
    { status: 'success', data: { results: { round: 2, revision: 9, kings: [], queens: [] } } },
  ];
  const api = createApi({ fetchImpl: async (url) => { seen.push(url); return new Response(JSON.stringify(responses.shift())); } });
  assert.equal((await api.settings()).announcementOpen, true);
  assert.deepEqual(await api.results(), { king: [], queen: [], round: 2, revision: 9 });
  assert.deepEqual(seen, ['/api/v1/settings', '/api/v1/results']);
});
