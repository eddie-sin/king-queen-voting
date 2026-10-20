import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.js';
import { publicLantern } from '../src/domain.js';

test('public lantern projection preserves safe display fields and legacy entries', () => {
  assert.deepEqual(publicLantern({ _id: 'l1', section: 'lantern', url: '/uploads/gallery/lantern/a.png', title: ' Moon ', description: ' Light ', ownerId: 'private' }), {
    _id: 'l1', url: '/uploads/gallery/lantern/a.png', title: 'Moon', description: 'Light',
  });
  assert.deepEqual(publicLantern({ _id: 'old', section: 'lantern', url: 'https://images.example/old.webp' }), {
    _id: 'old', url: 'https://images.example/old.webp', title: 'Festival lantern', description: '',
  });
  assert.equal(publicLantern({ _id: 'x', section: 'memory', url: '/uploads/x.png' }), null);
  assert.equal(publicLantern({ _id: 'x', section: 'lantern', url: 'javascript:alert(1)' }), null);
});

test('public lantern API requests only the lantern gallery and sanitizes entries', async () => {
  const seen = [];
  const api = createApi({ fetchImpl: async (url, options) => {
    seen.push({ url, options });
    return new Response(JSON.stringify({ status: 'success', data: { images: [
      { _id: 'l1', section: 'lantern', url: '/uploads/gallery/lantern/a.png', title: 'Moon', description: 'Glow' },
      { _id: 'm1', section: 'memory', url: '/uploads/gallery/memory/a.png', title: 'Private mismatch' },
    ] } }));
  } });
  assert.deepEqual(await api.lanterns(), [{ _id: 'l1', url: '/uploads/gallery/lantern/a.png', title: 'Moon', description: 'Glow' }]);
  assert.equal(seen[0].url, '/api/v1/images?section=lantern');
  assert.equal(seen[0].options.method, 'GET');
});
