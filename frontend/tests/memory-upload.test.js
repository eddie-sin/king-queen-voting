import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.js';
import { uploadSelectionError, parseUploadedMemory } from '../src/memory/upload.js';
import { memoryTabFromHash } from '../src/memory/demo.js';
const photo = { id: 'a'.repeat(24), status: 'PENDING', createdAt: '2026-10-22T10:00:00Z' };
test('upload sends one FormData images file with JWT and browser-generated content type', async () => {
  const file = new File(['image'], 'memory.png', { type: 'image/png' });
  const api = createApi({ fetchImpl: async (url, options) => {
    assert.equal(url, '/api/v1/memory-photos'); assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer student'); assert.equal(options.headers['Content-Type'], undefined);
    assert(options.body instanceof FormData); assert.deepEqual([...options.body.keys()], ['images']);
    assert.equal(options.body.get('images').name, 'memory.png');
    return new Response(JSON.stringify({ status: 'success', data: { photo: { ...photo, imageKey: 'private' } } }), { status: 201 });
  } });
  assert.deepEqual(await api.uploadMemoryPhoto('student', file), photo);
});
test('upload selection respects server remaining slots and exact file type/size limits', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(uploadSelectionError({ type, size: 5 * 1024 * 1024 }, 0, 1), '');
  for (const [file, count, slots] of [[{ type: 'image/png', size: 1 }, 1, 1], [{ type: 'image/png', size: 1 }, 0, 0], [{ type: 'image/gif', size: 1 }, 0, 3], [{ type: 'image/png', size: 5242881 }, 0, 3], [{ type: 'image/png', size: 0 }, 0, 3]]) assert(uploadSelectionError(file, count, slots));
  assert.equal(memoryTabFromHash('#memory-upload-demo'), 'upload');
});
test('upload confirmation validates PENDING and strips private data', () => {
  assert.deepEqual(parseUploadedMemory({ ...photo, url: 'private' }), photo);
  for (const change of [{ status: 'APPROVED' }, { id: 'bad' }, { createdAt: 'bad' }]) assert.throws(() => parseUploadedMemory({ ...photo, ...change }));
});
test('upload rejects no session/invalid file and flags ambiguous confirmation without retrying', async () => {
  let calls = 0; const api = createApi({ fetchImpl: async () => { calls++; return new Response(JSON.stringify({ status: 'success', data: {} }), { status: 201 }); } });
  const file = new File(['image'], 'memory.png', { type: 'image/png' });
  await assert.rejects(api.uploadMemoryPhoto('', file), e => e.status === 401);
  await assert.rejects(api.uploadMemoryPhoto('student', new File(['x'], 'x.gif', { type: 'image/gif' })), e => e.status === 400);
  assert.equal(calls, 0);
  await assert.rejects(api.uploadMemoryPhoto('student', file), e => e.interrupted); assert.equal(calls, 1);
});
