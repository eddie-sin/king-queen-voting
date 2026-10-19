import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../src/api.js';

test('protected endpoints use exact methods, Bearer header and JSON body including DELETE', async () => {
  const seen = [];
  const api = createApi({ fetchImpl: async (url, options) => { seen.push({ url, ...options }); return new Response(JSON.stringify({ status: 'success', data: { votes: [] }, message: 'OK' })); } });
  const key = 'b'.repeat(64);
  await api.myVotes('token', key); await api.submit('token', key, 'k1', 'king'); await api.change('token', key, 'q2', 'queen'); await api.remove('token', key, 'queen');
  assert.deepEqual(seen.map(x => [x.method, x.url]), [['POST','/api/v1/voting/my-votes'],['POST','/api/v1/voting/submit'],['PATCH','/api/v1/voting/change'],['DELETE','/api/v1/voting/remove']]);
  for (const request of seen) { assert.equal(request.headers.Authorization, 'Bearer token'); assert.equal(request.url.includes(key), false); assert.equal(request.cache, 'no-store'); }
  assert.deepEqual(JSON.parse(seen[3].body), { votingKey: key, contest: 'queen' });
});
test('unsuccessful HTTP status is rejected even with success payload', async () => {
  const api = createApi({ fetchImpl: async () => new Response(JSON.stringify({ status: 'success', message: 'Wrong key' }), { status: 401 }) });
  await assert.rejects(api.myVotes('token', 'a'.repeat(64)), error => error instanceof ApiError && error.status === 401);
});
test('fail body, network interruption and unreadable JSON are rejected', async () => {
  const api = createApi({ fetchImpl: async () => new Response(JSON.stringify({ status: 'fail', message: 'Not open' })) });
  await assert.rejects(api.submit('token', 'x', 'c1', 'king'), /Not open/);
  const network = createApi({ fetchImpl: async () => { throw new TypeError('Network error'); } });
  await assert.rejects(network.submit('token', 'x', 'c1', 'king'), error => error.interrupted);
  const invalid = createApi({ fetchImpl: async () => new Response('not JSON') });
  await assert.rejects(invalid.remove('token', 'x', 'king'), error => error.interrupted);
});
test('server messages do not echo a voting key into the UI', async () => {
  const key = 'c'.repeat(64);
  const api = createApi({ fetchImpl: async () => new Response(JSON.stringify({ status: 'fail', message: `Invalid key ${key}` }), { status: 401 }) });
  await assert.rejects(api.myVotes('token', key), error => !error.message.includes(key));
});
