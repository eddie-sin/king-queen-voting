import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../src/api.js';
import { parseMyMemories } from '../src/memory/mine.js';
import { readStoredSession, writeStoredSession } from '../src/hooks/useFestival.js';

const photos = ['PENDING', 'APPROVED', 'REJECTED'].map((status, index) => ({ id: String(index + 1).padStart(24, '0'), status, createdAt: '2026-10-22T10:00:00.000Z' }));
const data = { photos, quota: { limit: 3, acceptedCount: 3, remainingSlots: 0 } };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('My Memories GET uses the cookie without exposing credentials in headers or URLs', async () => {
  let seen;
  const api = createApi({ fetchImpl: async (url, options) => { seen = { url, ...options }; return response({ status: 'success', data }); } });
  assert.deepEqual(await api.myMemoryPhotos('student-fixture-token'), data);
  assert.equal(seen.url, '/api/v1/memory-photos/mine');
  assert.equal(seen.method, 'GET'); assert.equal(seen.body, undefined);
  assert.equal(seen.headers.Authorization, undefined);
  assert.equal(seen.cache, 'no-store'); assert.equal(seen.credentials, 'same-origin');
  assert(!seen.url.includes('student-fixture-token'));
});

test('My Memories preserves three review states and server quota independently of visible cards', () => {
  const input = { photos: [{ ...photos[1], imageKey: 'private-key', url: 'https://untrusted.invalid/image', reviewedBy: 'private-admin' }], quota: { limit: 3, acceptedCount: 2, remainingSlots: 0 } };
  assert.deepEqual(parseMyMemories(input), { photos: [photos[1]], quota: input.quota });
  assert.deepEqual(parseMyMemories(data), data);
  assert.deepEqual(parseMyMemories({ photos: [], quota: { limit: 3, acceptedCount: 0, remainingSlots: 2 } }).quota, { limit: 3, acceptedCount: 0, remainingSlots: 2 });
});

test('My Memories rejects malformed records, cancellation states and missing quota instead of showing demo fallback', async () => {
  for (const invalid of [null, {}, { photos, quota: null }, { ...data, quota: { limit: 3, acceptedCount: '3', remainingSlots: 0 } }, { ...data, quota: { limit: 3, acceptedCount: 1, remainingSlots: 4 } },
    { ...data, photos: [{ ...photos[0], status: 'CANCELLED' }] }, { ...data, photos: [{ ...photos[0], id: 'https://example.com' }] },
    { ...data, photos: [{ ...photos[0], createdAt: 'invalid' }] }, { ...data, photos: [photos[0], photos[0]] }]) {
    const api = createApi({ fetchImpl: async () => response({ status: 'success', data: invalid }) });
    await assert.rejects(api.myMemoryPhotos('fixture'), ApiError);
  }
});

test('expired, forbidden, disabled and network failures retain existing API error semantics', async () => {
  for (const status of [401, 403, 500]) {
    const api = createApi({ fetchImpl: async () => response({ status: 'fail', message: 'Unavailable' }, status) });
    await assert.rejects(api.myMemoryPhotos('fixture'), error => error instanceof ApiError && error.status === status);
  }
  const api = createApi({ fetchImpl: async () => { throw new TypeError('offline'); } });
  await assert.rejects(api.myMemoryPhotos('fixture'), error => error.interrupted === true);
});

test('approved image URL always uses the configured backend endpoint and validates photo IDs', () => {
  assert.equal(createApi().memoryPhotoImageUrl(photos[1].id), `/api/v1/memory-photos/${photos[1].id}/image`);
  assert.equal(createApi({ baseUrl: '/backend/api/v1' }).memoryPhotoImageUrl(photos[1].id), `/backend/api/v1/memory-photos/${photos[1].id}/image`);
  assert.throws(() => createApi().memoryPhotoImageUrl('../private'), ApiError);
});

test('Memory reuses the existing festival session store without a second token or credential store', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const stored = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  const session = { token: 'session-fixture', user: { id: 'student-fixture' } };
  writeStoredSession(session); assert.deepEqual(readStoredSession(), session);
  assert.deepEqual([...stored.keys()], []);
  writeStoredSession(null); assert.equal(readStoredSession(), null);
});
