import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../src/api.js';

test('v2 voting endpoints use Bearer sessions, final-vote methods and control fencing', async () => {
  const seen = [];
  const api = createApi({ fetchImpl: async (url, options) => {
    seen.push({ url, ...options });
    return new Response(JSON.stringify({ status: 'success', data: { votes: [], round: 4, window: 7 }, message: 'OK' }));
  } });
  await api.myVotes('student-jwt');
  await api.submit('student-jwt', '507f1f77bcf86cd799439011', 'king', { round: 4, window: 7 });
  assert.deepEqual(seen.map(request => [request.method, request.url]), [
    ['GET', '/api/v1/voting/my-votes'], ['POST', '/api/v1/voting/submit'],
  ]);
  for (const request of seen) {
    assert.equal(request.headers.Authorization, 'Bearer student-jwt');
    assert.equal(request.cache, 'no-store'); assert.equal(request.credentials, 'omit');
  }
  assert.equal(seen[0].body, undefined);
  assert.deepEqual(JSON.parse(seen[1].body), {
    candidateId: '507f1f77bcf86cd799439011', contest: 'king', round: 4, window: 7,
  });
});
test('unsuccessful HTTP status is rejected even with success payload', async () => {
  const api = createApi({ fetchImpl: async () => new Response(JSON.stringify({ status: 'success', message: 'Wrong key' }), { status: 401 }) });
  await assert.rejects(api.myVotes('token'), error => error instanceof ApiError && error.status === 401);
});
test('fail body, network interruption and unreadable JSON are rejected', async () => {
  const api = createApi({ fetchImpl: async () => new Response(JSON.stringify({ status: 'fail', message: 'Not open' })) });
  await assert.rejects(api.submit('token', '507f1f77bcf86cd799439011', 'king', { round: 1, window: 1 }), /Not open/);
  const network = createApi({ fetchImpl: async () => { throw new TypeError('Network error'); } });
  await assert.rejects(network.submit('token', '507f1f77bcf86cd799439011', 'king', { round: 1, window: 1 }), error => error.interrupted);
  const invalid = createApi({ fetchImpl: async () => new Response('not JSON') });
  await assert.rejects(invalid.myVotes('token'), error => error.interrupted === false);
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

test('student registration, login and session refresh use the current account contract', async () => {
  const seen = [];
  const responses = [
    { status: 'success', data: { user: { id: 'u1', email: 'student@example.test' } } },
    { status: 'success', data: { token: 'student-jwt', user: { id: 'u1', email: 'student@example.test' } } },
    { status: 'success', data: { user: { id: 'u1', email: 'student@example.test', round: 2 } } },
  ];
  const api = createApi({ fetchImpl: async (url, options) => {
    seen.push({ url, ...options }); return new Response(JSON.stringify(responses.shift()));
  } });
  await api.register('student@example.test', 'safe-password');
  await api.login('student@example.test', 'safe-password');
  assert.equal((await api.me('student-jwt')).round, 2);
  assert.deepEqual(seen.map(request => [request.method, request.url]), [
    ['POST', '/api/v1/auth/register'], ['POST', '/api/v1/auth/login'], ['GET', '/api/v1/auth/me'],
  ]);
  assert.deepEqual(JSON.parse(seen[0].body), { email: 'student@example.test', password: 'safe-password' });
  assert.deepEqual(JSON.parse(seen[1].body), { email: 'student@example.test', password: 'safe-password' });
  assert.equal(seen[2].headers.Authorization, 'Bearer student-jwt');
});
