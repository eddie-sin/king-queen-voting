import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.js';
import { parseLikeStates, parseLikeMutation } from '../src/memory/likes.js';
import './auth-fixture.js';
const id = 'a'.repeat(24), other = 'b'.repeat(24);
test('like adapter uses cookies and CSRF for bodyless POST/DELETE', async () => {
  const calls = [];
  const api = createApi({ fetchImpl: async (url, options) => {
    calls.push([url, options.method]); assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.credentials,'same-origin');
    if(options.method!=='GET')assert.equal(options.headers['X-CSRF-Token'],'fixture-csrf');
    assert.equal(options.body, undefined); assert.equal(options.headers['Content-Type'], undefined);
    assert.equal(options.cache, 'no-store');
    return new Response(JSON.stringify(options.method === 'GET' ? { status: 'success', results: 1, data: { photos: [{ photoId: id, liked: true }] } } : { status: 'success', data: { photoId: id, liked: options.method === 'POST', likeCount: 7 } }));
  } });
  assert.deepEqual(await api.memoryPhotoLikeStates('student', [id, other]), [{ photoId: id, liked: true }]);
  assert.deepEqual(await api.setMemoryPhotoLike('student', id, true), { photoId: id, liked: true, likeCount: 7 });
  assert.equal((await api.setMemoryPhotoLike('student', id, false)).liked, false);
  assert.deepEqual(calls, [[`/api/v1/memory-photos/like-status?photoIds=${id},${other}`, 'GET'], [`/api/v1/memory-photos/${id}/like`, 'POST'], [`/api/v1/memory-photos/${id}/like`, 'DELETE']]);
});
test('status parser preserves omissions as unknown, rejects malformed/foreign/duplicate states', () => {
  const payload = photos => ({ results: photos.length, data: { photos } });
  assert.deepEqual(parseLikeStates(payload([]), [id]), []);
  assert.deepEqual(parseLikeStates(payload([{ photoId: id, liked: false, userId: 'private' }]), [id]), [{ photoId: id, liked: false }]);
  for (const photos of [[{ photoId: other, liked: true }], [{ photoId: id, liked: 'false' }], [{ photoId: id, liked: true }, { photoId: id, liked: false }]]) assert.throws(() => parseLikeStates(payload(photos), [id]));
  assert.throws(() => parseLikeMutation({ photoId: other, liked: true, likeCount: 1 }, id));
  assert.throws(() => parseLikeMutation({ photoId: id, liked: true, likeCount: -1 }, id));
});
test('like requests validate auth/IDs and preserve failure/uncertainty without retries', async () => {
  let calls = 0;
  const api = createApi({ fetchImpl: async () => { calls++; return new Response(JSON.stringify({ status: 'success', data: {} })); } });
  await assert.rejects(api.memoryPhotoLikeStates('', [id]), error => error.status === 401);
  await assert.rejects(api.memoryPhotoLikeStates('student', [id, id]));
  await assert.rejects(api.setMemoryPhotoLike('student', 'bad', true)); assert.equal(calls, 0);
  await assert.rejects(api.setMemoryPhotoLike('student', id, true), error => error.interrupted); assert.equal(calls, 1);
  for (const status of [401, 403, 404, 500]) {
    const failed = createApi({ fetchImpl: async (url) => {
      if (url.endsWith('/auth/config')) {
        return new Response(JSON.stringify({ status: 'success', data: { csrfToken: 'fixture-csrf', refreshAfter: 60000 } }));
      }
      return new Response(JSON.stringify({ status: 'fail' }), { status });
    } });
    await assert.rejects(failed.setMemoryPhotoLike('student', id, true), error => error.status === status);
  }
});
