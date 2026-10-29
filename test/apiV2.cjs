const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ObjectId } = require('mongoose').Types;
const { createV2Fixture } = require('./fixtures/v2Fixture.cjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
let fixture;

before(async () => { fixture = await createV2Fixture(); }, { timeout: 30000 });
beforeEach(async () => fixture.reset(), { timeout: 30000 });
after(async () => fixture?.close(), { timeout: 30000 });

const student = email => fixture.student(email || `${crypto.randomUUID()}@example.test`);
const candidateBody = (category = 'king', extra = {}) => ({
  fullName: `Candidate ${crypto.randomUUID()}`, batchNumber: '1',
  images: ['https://example.test/candidate.png'], contactNumber: '09123456789', category, ...extra,
});
const createCandidate = async (category = 'king', extra = {}) => {
  const response = await fixture.request('POST', '/candidates', { token: fixture.token, body: candidateBody(category, extra) });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.candidate;
};
const candidateForm = (data, files = [PNG]) => {
  const form = new FormData(); form.append('data', JSON.stringify(data));
  files.forEach((bytes, index) => form.append('images', new Blob([bytes], { type: 'image/png' }), `candidate-${index}.png`));
  return form;
};
const galleryForm = (section, files = [PNG], extra = {}) => {
  const form = new FormData(); form.append('section', section);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  files.forEach((bytes, index) => form.append('images', new Blob([bytes], { type: 'image/png' }), `gallery-${index}.png`));
  return form;
};

test('candidate CRUD keeps private fields out of public responses and retains them for ADMIN', async () => {
  const active = await createCandidate('king');
  const inactive = await createCandidate('queen', { isActive: false });
  const publicList = await fixture.request('GET', '/candidates');
  assert.equal(publicList.status, 200); assert.equal(publicList.body.results, 1);
  assert.equal(publicList.body.data.candidates[0]._id, active._id);
  assert.equal(publicList.body.data.candidates[0].contactNumber, undefined);
  assert.equal((await fixture.request('GET', `/candidates/${inactive._id}`)).status, 404);
  const adminList = await fixture.request('GET', '/admin/candidates', { token: fixture.token });
  assert.equal(adminList.status, 200); assert.equal(adminList.body.results, 2);
  assert(adminList.body.data.candidates.every(item => item.contactNumber));
  const edited = await fixture.request('PATCH', `/candidates/${active._id}`, {
    token: fixture.token, body: { fullName: 'Edited candidate', contactNumber: '09999', isActive: false },
  });
  assert.equal(edited.status, 200); assert.equal(edited.body.data.candidate.contactNumber, '09999');
  assert.equal((await fixture.request('GET', `/candidates/${active._id}`)).status, 404);
  assert.equal((await fixture.request('DELETE', `/candidates/${inactive._id}`, { token: fixture.token })).status, 204);
});

test('candidate mutations reject anonymous, student and malformed requests without partial writes', async () => {
  const user = await student(); const candidate = await createCandidate();
  for (const [method, endpoint, body] of [
    ['POST', '/candidates', candidateBody()], ['PATCH', `/candidates/${candidate._id}`, { fullName: 'Unauthorized' }],
    ['DELETE', `/candidates/${candidate._id}`, undefined],
  ]) {
    assert.equal((await fixture.request(method, endpoint, { body })).status, 401);
    assert.equal((await fixture.request(method, endpoint, { token: user.token, body })).status, 401);
  }
  const beforeCandidates = await fixture.db.collection('candidates').countDocuments();
  const beforeActions = await fixture.db.collection('adminactions').countDocuments();
  for (const body of [
    { ...candidateBody(), category: 'prince' }, { ...candidateBody(), fullName: '' },
    { ...candidateBody(), images: [] }, { ...candidateBody(), unknown: true },
  ]) assert.equal((await fixture.request('POST', '/candidates', { token: fixture.token, body })).status, 400);
  assert.equal(await fixture.db.collection('candidates').countDocuments(), beforeCandidates);
  assert.equal(await fixture.db.collection('adminactions').countDocuments(), beforeActions);
});

test('candidate photos upload, reorder, replace and delete through transactional staff mutations', async () => {
  const created = await fixture.request('POST', '/candidates', { token: fixture.token,
    body: candidateForm({ fullName: 'Photo candidate', category: 'king', hobbiesAndInterests: ['chess'] }, [PNG, PNG]) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const candidate = created.body.data.candidate; assert.equal(candidate.images.length, 2);
  for (const url of candidate.images) {
    const asset = await fixture.asset(url); assert.equal(asset.status, 200); assert.deepEqual(asset.bytes, PNG);
    assert.equal(asset.headers.get('x-content-type-options'), 'nosniff');
  }
  const [first, second] = candidate.images;
  let response = await fixture.request('PATCH', `/candidates/${candidate._id}`, { token: fixture.token,
    body: candidateForm({ photoLayout: [{ keep: second }, { upload: 0 }] }) });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const replacement = response.body.data.candidate.images[1];
  assert.deepEqual(response.body.data.candidate.images, [second, replacement]);
  assert.equal(response.body.data.storageCleanup.deleted, 1); assert.equal((await fixture.asset(first)).status, 404);
  response = await fixture.request('PATCH', `/candidates/${candidate._id}`, { token: fixture.token,
    body: { photoLayout: [{ keep: replacement }, { keep: second }] } });
  assert.equal(response.status, 200); assert.deepEqual(response.body.data.candidate.images, [replacement, second]);
  assert.equal((await fixture.request('DELETE', `/candidates/${candidate._id}`, { token: fixture.token })).status, 204);
  assert.equal((await fixture.asset(replacement)).status, 404); assert.equal((await fixture.asset(second)).status, 404);
});

test('candidate photo validation rejects unsafe layouts without changing accepted photos', async () => {
  const created = await fixture.request('POST', '/candidates', { token: fixture.token,
    body: candidateForm({ fullName: 'Strict photos', category: 'queen' }, [PNG, PNG]) });
  assert.equal(created.status, 201); const candidate = created.body.data.candidate; const original = [...candidate.images];
  const cases = [
    candidateForm({ bio: 'files without layout' }),
    candidateForm({ photoLayout: [{ keep: original[0] }, { keep: original[0] }] }, []),
    candidateForm({ photoLayout: [{ keep: '/uploads/candidates/not-owned.png' }] }, []),
    candidateForm({ photoLayout: [{ keep: original[0] }, { upload: 1 }] }),
    candidateForm({ fullName: '', photoLayout: [{ keep: original[0] }, { upload: 0 }] }),
  ];
  for (const body of cases) {
    const response = await fixture.request('PATCH', `/candidates/${candidate._id}`, { token: fixture.token, body });
    assert([400, 409].includes(response.status), JSON.stringify(response.body));
  }
  assert.equal((await fixture.request('PATCH', `/candidates/${candidate._id}`, {
    token: fixture.token, body: { images: ['https://example.test/replacement.png'] },
  })).status, 400);
  const current = await fixture.request('GET', `/admin/candidates/${candidate._id}`, { token: fixture.token });
  assert.deepEqual(current.body.data.candidate.images, original);
  for (const url of original) assert.equal((await fixture.asset(url)).status, 200);
});

test('managed candidate files survive while referenced and are removed after the last owner', async () => {
  const uploaded = await fixture.request('POST', '/candidates', { token: fixture.token,
    body: candidateForm({ fullName: 'Owner', category: 'king' }) });
  assert.equal(uploaded.status, 201); const owner = uploaded.body.data.candidate; const shared = owner.images[0];
  const otherId = new ObjectId();
  await fixture.db.collection('candidates').insertOne({ _id: otherId, fullName: 'Second owner', category: 'queen', images: [shared], isActive: true });
  const replaced = await fixture.request('PATCH', `/candidates/${owner._id}`, { token: fixture.token,
    body: candidateForm({ photoLayout: [{ upload: 0 }] }) });
  assert.equal(replaced.status, 200); assert.equal((await fixture.asset(shared)).status, 200);
  assert.equal((await fixture.request('DELETE', `/candidates/${otherId}`, { token: fixture.token })).status, 204);
  assert.equal((await fixture.asset(shared)).status, 404);
});

test('legacy public gallery remains locally served while writes require authorized staff', async () => {
  const user = await student();
  assert.equal((await fixture.request('POST', '/images', { body: galleryForm('memory') })).status, 401);
  assert.equal((await fixture.request('POST', '/images', { token: user.token, body: galleryForm('memory') })).status, 401);
  const created = await fixture.request('POST', '/images', { token: fixture.token, body: galleryForm('memory') });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const image = created.body.data.images[0]; assert.equal(image.section, 'memory');
  assert.equal((await fixture.asset(image.url)).status, 200);
  const listed = await fixture.request('GET', '/images?section=memory');
  assert.equal(listed.status, 200); assert.equal(listed.body.results, 1);
  assert.equal(listed.body.data.images[0]._id, image._id);
  assert.equal((await fixture.request('DELETE', `/images/${image._id}`, { token: fixture.token })).status, 204);
  assert.equal((await fixture.asset(image.url)).status, 404);
});

test('gallery validation rejects missing files, invalid sections and missing records', async () => {
  const empty = new FormData(); empty.append('section', 'memory');
  assert.equal((await fixture.request('POST', '/images', { token: fixture.token, body: empty })).status, 400);
  assert.equal((await fixture.request('POST', '/images', { token: fixture.token, body: galleryForm('unknown') })).status, 400);
  assert.equal((await fixture.request('PATCH', `/images/${new ObjectId()}`, { token: fixture.token, body: { title: 'Missing' } })).status, 404);
  assert.equal((await fixture.request('DELETE', `/images/${new ObjectId()}`, { token: fixture.token })).status, 404);
  assert.equal(await fixture.db.collection('images').countDocuments(), 0);
});

test('Wish Sky is anonymous to read, student-only to write and atomically limited to three', async () => {
  const owner = await student(); const other = await student();
  assert.deepEqual((await fixture.request('GET', '/wishes/mine', { token: owner.token })).body.data, { used: 0, remaining: 3 });
  assert.equal((await fixture.request('GET', '/wishes/mine')).status, 401);
  assert.equal((await fixture.request('POST', '/wishes', { body: { message: 'Hello' } })).status, 401);
  assert.equal((await fixture.request('POST', '/wishes', { token: fixture.token, body: { message: 'Hello' } })).status, 401);
  for (const body of [{}, { message: ' ' }, { message: 123 }, { message: 'Hi', user: owner.user.id }]) {
    assert.equal((await fixture.request('POST', '/wishes', { token: owner.token, body })).status, 400);
  }
  const attempts = await Promise.all(Array.from({ length: 8 }, (_, index) => fixture.request('POST', '/wishes', {
    token: owner.token, body: { message: `Wish ${index}` },
  })));
  assert.equal(attempts.filter(response => response.status === 201).length, 3);
  assert.equal(attempts.filter(response => response.status === 409).length, 5);
  assert.equal(await fixture.db.collection('wishes').countDocuments({ user: new ObjectId(owner.user.id) }), 3);
  assert.deepEqual((await fixture.request('GET', '/wishes/mine', { token: owner.token })).body.data, { used: 3, remaining: 0 });
  assert.equal((await fixture.request('POST', '/wishes', { token: other.token, body: { message: 'Another wish', name: '  Aye  ' } })).status, 201);
  const publicList = await fixture.request('GET', '/wishes');
  assert.equal(publicList.status, 200); assert.equal(publicList.body.results, 4);
  for (const wish of publicList.body.data.wishes) {
    // Explicit public allowlist: reaction metadata and optional display name are public;
    // account ownership, timestamps, browser identity and quota slots stay private.
    assert.deepEqual(Object.keys(wish).sort(), wish.name
      ? ['id', 'message', 'name', 'reacted', 'reactions']
      : ['id', 'message', 'reacted', 'reactions']);
    assert.equal(wish.reactions, 0);
    assert.equal(wish.reacted, false);
  }
  assert.equal(publicList.body.data.wishes.find(wish => wish.message === 'Another wish').name, 'Aye');
  for (const privateValue of [owner.user.id, other.user.id, owner.user.email, other.user.email].filter(Boolean)) {
    assert.equal(JSON.stringify(publicList.body).includes(privateValue), false);
  }
});

test('Wish Sky cursor pagination visits each record once and validates input', async () => {
  const timestamp = new Date('2026-10-28T05:30:00.000Z');
  await fixture.db.collection('wishes').insertMany(Array.from({ length: 105 }, (_, index) => ({
    user: new ObjectId(), slot: 1, message: `Wish ${index}`,
    createdAt: new Date(timestamp.getTime() - Math.floor(index / 5) * 1000),
  })));
  const seen = new Set(); let cursor;
  do {
    const query = new URLSearchParams({ limit: '40' }); if (cursor) query.set('cursor', cursor);
    const response = await fixture.request('GET', `/wishes?${query}`); assert.equal(response.status, 200);
    response.body.data.wishes.forEach(wish => {
      assert.deepEqual(Object.keys(wish).sort(), ['id', 'message', 'reacted', 'reactions']);
      assert.equal(wish.reactions, 0); assert.equal(wish.reacted, false);
      assert.equal(seen.has(wish.id), false, 'Cursor pages must not repeat a wish');
      seen.add(wish.id);
    });
    cursor = response.body.data.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 105);
  for (const query of ['page=0', 'limit=51', 'cursor=invalid&limit=40', 'page=1&cursor=invalid']) {
    assert.equal((await fixture.request('GET', `/wishes?${query}`)).status, 400);
  }
});
