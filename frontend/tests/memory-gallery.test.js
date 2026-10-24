import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.js';
import { parseMemoryGallery } from '../src/memory/gallery.js';
import { memoryTabFromHash } from '../src/memory/demo.js';
const photo = { id: 'a'.repeat(24), createdAt: '2026-10-22T10:00:00Z', likeCount: 7 };
const payload = () => ({ status: 'success', results: 1, pagination: { page: 1, limit: 20, hasMore: false }, data: { photos: [{ ...photo }] } });
test('public gallery uses bounded pagination without authentication and preserves backend counts', async () => {
  const api = createApi({ fetchImpl: async (url, options) => {
    assert.equal(url, '/api/v1/memory-photos?page=1&limit=20');
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.cache, 'no-store');
    return new Response(JSON.stringify(payload()));
  } });
  assert.deepEqual((await api.memoryPhotos()).photos, [photo]);
  await assert.rejects(api.memoryPhotos(1001));
  assert.equal(memoryTabFromHash('#memory-gallery-demo'), 'all');
});
test('gallery projection strips storage and identity fields', () => {
  const data = payload(); Object.assign(data.data.photos[0], { imageKey: 'private', url: 'https://example.test', reviewedBy: 'admin' });
  assert.deepEqual(parseMemoryGallery(data, 1).photos, [photo]);
});
test('gallery rejects malformed metadata, private statuses and inconsistent pagination', () => {
  for (const mutate of [p => p.data.photos[0].status = 'PENDING', p => p.data.photos[0].likeCount = -1,
    p => p.data.photos[0].id = 'bad', p => p.data.photos[0].createdAt = 'bad', p => p.pagination.page = 2,
    p => p.pagination.hasMore = true, p => p.results = 5, p => p.data.photos.push(p.data.photos[0])]) {
    const data = payload(); mutate(data); assert.throws(() => parseMemoryGallery(data, 1));
  }
});
test('gallery reports disabled, network and malformed responses without demo fallback', async () => {
  for (const status of [403, 500]) {
    const api = createApi({ fetchImpl: async () => new Response(JSON.stringify({ status: 'fail' }), { status }) });
    await assert.rejects(api.memoryPhotos(), error => error.status === status);
  }
  await assert.rejects(createApi({ fetchImpl: async () => { throw Error('offline'); } }).memoryPhotos());
  await assert.rejects(createApi({ fetchImpl: async () => new Response(JSON.stringify({ status: 'success' })) }).memoryPhotos(), /incomplete/);
});
