const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongoose').Types;
const { createV2Fixture } = require('./fixtures/v2Fixture.cjs');

let fixture;
before(async () => { fixture = await createV2Fixture(); }, { timeout: 60000 });
beforeEach(async () => { await fixture.reset(); }, { timeout: 60000 });
after(async () => { await fixture?.close(); }, { timeout: 30000 });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
async function students(count) {
  const accounts = [];
  for (let index = 0; index < count; index++) {
    accounts.push(await fixture.student(`memory-${index}-${crypto.randomBytes(4).toString('hex')}@gmail.com`));
  }
  return accounts;
}
async function enable(token = fixture.token) { assert.equal((await fixture.command('memory.open', token)).status, 200); }
async function disable(token = fixture.token) { assert.equal((await fixture.command('memory.close', token)).status, 200); }
function photoForm(bytes = PNG, type = 'image/png', name = 'memory.png', extra) {
  const form = new FormData(); form.append('images', new Blob([bytes], { type }), name);
  if (extra !== undefined) form.append('caption', extra); return form;
}
async function upload(student, form = photoForm()) {
  return fixture.request('POST', '/memory-photos', { token: student.token, body: form });
}
async function submit(student) {
  const response = await upload(student); assert.equal(response.status, 201); return response.body.data.photo;
}
async function memoryAdmin(permissions = [], username = `memory-${crypto.randomBytes(4).toString('hex')}`) {
  return fixture.staff('memory_admin', permissions, username);
}
const review = (id, status, token = fixture.token) => fixture.request('PATCH', `/admin/memory-photos/${id}/review`, { token, body: { status } });

test('My Memories authenticates active students, isolates owners, hides sensitive fields and excludes cancellation fences', async () => {
  const [first, second] = await students(2); await enable(); const older = await submit(first); await new Promise(resolve => setTimeout(resolve, 5)); const newer = await submit(first); await submit(second);
  const marker = new ObjectId();
  await fixture.db.collection('memoryphotos').insertOne({ _id: marker, owner: new ObjectId(first.user.id), cancelled: true, createdAt: new Date() });
  await fixture.db.collection('memoryphotoquotas').updateOne({ _id: new ObjectId(first.user.id) }, { $push: { slots: marker } });
  const mine = await fixture.request('GET', '/memory-photos/mine', { token: first.token });
  assert.equal(mine.status, 200); assert.deepEqual(mine.body.data.photos.map(photo => photo.id), [newer.id, older.id]);
  assert.deepEqual(Object.keys(mine.body.data.photos[0]).sort(), ['createdAt', 'id', 'status']);
  assert.deepEqual(mine.body.data.quota, { limit: 3, acceptedCount: 2, remainingSlots: 1 });
  assert.equal(JSON.stringify(mine.body).includes('imageKey'), false); assert.equal(JSON.stringify(mine.body).includes('reviewedBy'), false);
  assert.equal((await fixture.request('GET', '/memory-photos/mine')).status, 401);
  assert.equal((await fixture.request('GET', '/memory-photos/mine', { token: fixture.token })).status, 401);
  const forged = jwt.sign({ userId: second.user.id, role: 'user', v: 0 }, fixture.secret, { expiresIn: '1h' });
  assert.equal((await fixture.request('GET', '/memory-photos/mine', { token: forged })).status, 401, 'retired student JWTs cannot impersonate cookie sessions');
  assert.equal((await fixture.request('GET', '/memory-photos/mine', { token: second.token })).body.data.photos.length, 1);
});

test('feature disable blocks history, uploads, gallery, likes and like-status without deleting submissions', async () => {
  const [student] = await students(1); await enable(); const photo = await submit(student); await disable();
  assert.equal((await fixture.request('GET', '/memory-photos/mine', { token: student.token })).status, 403);
  assert.equal((await upload(student)).status, 403);
  assert.equal((await fixture.request('GET', '/memory-photos?page=1&limit=20')).status, 403);
  assert.equal((await fixture.request('POST', `/memory-photos/${photo.id}/like`, { token: student.token })).status, 403);
  assert.equal((await fixture.request('GET', `/memory-photos/like-status?photoIds=${photo.id}`, { token: student.token })).status, 403);
  assert.equal(await fixture.db.collection('memoryphotos').countDocuments({ _id: new ObjectId(photo.id), cancelled: { $ne: true } }), 1);
});

test('upload validates multipart shape, real image content, size and extra fields without consuming quota', async () => {
  const [student] = await students(1); await enable();
  const invalid = [
    ()=>fixture.request('POST', '/memory-photos', { token: student.token, body: {} }),
    ()=>upload(student, photoForm(Buffer.from('not an image'), 'image/png')),
    ()=>upload(student, photoForm(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png')),
    ()=>upload(student, photoForm(PNG, 'text/plain', 'bad.txt')),
    ()=>upload(student, photoForm(PNG, 'image/png', 'memory.png', 'not-supported')),
  ];
  for (const run of invalid) assert.equal((await run()).status, 400);
  const mine = await fixture.request('GET', '/memory-photos/mine', { token: student.token });
  assert.deepEqual(mine.body.data.quota, { limit: 3, acceptedCount: 0, remainingSlots: 3 });
  assert.equal(await fixture.db.collection('memoryphotos').countDocuments({ cancelled: { $ne: true } }), 0);
});

test('successful upload stores one private PENDING image and returns no key, bytes, URL or reviewer data', async () => {
  const [student] = await students(1); await enable(); const response = await upload(student);
  assert.equal(response.status, 201); assert.deepEqual(Object.keys(response.body.data.photo).sort(), ['createdAt', 'id', 'status']); assert.equal(response.body.data.photo.status, 'PENDING');
  const stored = await fixture.db.collection('memoryphotos').findOne({ _id: new ObjectId(response.body.data.photo.id) });
  assert.match(stored.imageKey, /^memory-photos\/[0-9a-f-]+\.png$/); assert.equal(stored.owner.toString(), student.user.id);
  const privatePath = path.join(fixture.privateDirectory, stored.imageKey); const sanitized = await fs.readFile(privatePath);
  assert(sanitized.length > 32); assert.deepEqual(sanitized.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal((await fixture.asset(`/uploads/${stored.imageKey}`)).status, 404);
  assert.equal(JSON.stringify(response.body).includes(stored.imageKey), false);
});

test('rejected submissions release one active slot while pending and approved photos remain capped at three', async () => {
  const [student] = await students(1); await enable(); const photos = [await submit(student), await submit(student), await submit(student)];
  assert.equal((await review(photos[0].id, 'APPROVED')).status, 200); assert.equal((await review(photos[1].id, 'REJECTED')).status, 200);
  assert.equal((await upload(student)).status, 201);
  const mine = await fixture.request('GET', '/memory-photos/mine', { token: student.token });
  assert.deepEqual(mine.body.data.quota, { limit: 3, acceptedCount: 3, remainingSlots: 0 });
  assert.deepEqual(new Set(mine.body.data.photos.map(photo => photo.status)), new Set(['APPROVED', 'REJECTED', 'PENDING']));
});

test('concurrent uploads atomically accept at most three and preserve unique quota slots', async () => {
  const [student] = await students(1); await enable();
  const responses = await Promise.all(Array.from({ length: 12 }, () => upload(student)));
  assert.equal(responses.filter(response => response.status === 201).length, 3);
  assert.equal(responses.filter(response => response.status === 409).length, 9);
  const records = await fixture.db.collection('memoryphotos').find({ owner: new ObjectId(student.user.id), cancelled: { $ne: true } }).toArray();
  const quota = await fixture.db.collection('memoryphotoquotas').findOne({ _id: new ObjectId(student.user.id) });
  assert.equal(records.length, 3); assert.equal(quota.slots.length, 3); assert.equal(new Set(quota.slots.map(String)).size, 3);
});

test('confirmed persistence failure cleans private bytes and releases only its fenced reservation', async () => {
  const [student] = await students(1); await enable();
  await fixture.db.command({ collMod: 'memoryphotos', validator: { $or: [{ cancelled: true }, { fixtureMustExist: { $exists: true } }] }, validationLevel: 'strict' });
  try { assert.equal((await upload(student)).status, 503); }
  finally { await fixture.db.command({ collMod: 'memoryphotos', validator: {}, validationLevel: 'off' }); }
  const quota = await fixture.db.collection('memoryphotoquotas').findOne({ _id: new ObjectId(student.user.id) });
  assert.deepEqual(quota.slots, []);
  const files = await fs.readdir(path.join(fixture.privateDirectory, 'memory-photos')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  assert.deepEqual(files, []); assert.equal((await submit(student)).status, 'PENDING');
});

test('durable cancellation recovery frees only cancelled slots across concurrent worker restarts', async () => {
  const [student] = await students(1); const owner = new ObjectId(student.user.id);
  const cancelled = new ObjectId(), accepted = new ObjectId(), unresolved = new ObjectId();
  await fixture.db.collection('memoryphotoquotas').insertOne({ _id: owner, slots: [cancelled, accepted, unresolved] });
  await fixture.db.collection('memoryphotos').insertMany([
    { _id: cancelled, owner, cancelled: true, createdAt: new Date() },
    { _id: accepted, owner, imageKey: `memory-photos/${crypto.randomUUID()}.png`, status: 'REJECTED', createdAt: new Date() },
  ]);
  await Promise.all(Array.from({ length: 4 }, () => fixture.recoverMemoryQuota(student.user.id)));
  const quota = await fixture.db.collection('memoryphotoquotas').findOne({ _id: owner });
  assert.deepEqual(new Set(quota.slots.map(String)), new Set([String(accepted), String(unresolved)]));
  await assert.rejects(fixture.db.collection('memoryphotos').insertOne({ _id: cancelled, owner, imageKey: `memory-photos/${crypto.randomUUID()}.png`, status: 'PENDING', createdAt: new Date() }), error => error.code === 11000);
  assert.equal((await fixture.db.collection('memoryphotos').findOne({ _id: cancelled })).cancelled, true);
});

test('moderation authorization is role-specific and remains available while the feature is disabled', async () => {
  const [student] = await students(1); await enable(); const photo = await submit(student); await disable();
  const reader = await memoryAdmin([]); const approver = await memoryAdmin(['memory.approve', 'memory.reject']);
  const voting = await fixture.staff('voting_admin', ['votes.read'], 'memory-voting-role'); const lantern = await fixture.staff('lantern_admin', ['lantern.votes.read'], 'memory-lantern-role');
  for (const token of [fixture.token, reader.token, approver.token]) {
    assert.equal((await fixture.request('GET', '/admin/memory-photos', { token })).status, 200);
    const image = await fixture.request('GET', `/admin/memory-photos/${photo.id}/image`, { token });
    assert.equal(image.status, 200); assert.deepEqual(image.bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); assert.match(image.headers.get('cache-control'), /no-store/);
  }
  assert.equal((await review(photo.id, 'APPROVED', reader.token)).status, 403);
  assert.equal((await review(photo.id, 'APPROVED', voting.token)).status, 403);
  assert.equal((await fixture.request('GET', '/admin/memory-photos', { token: lantern.token })).status, 403);
  assert.equal((await fixture.request('GET', '/admin/memory-photos', { token: student.token })).status, 401);
  assert.equal((await review(photo.id, 'APPROVED', approver.token)).status, 200);
});

test('moderation history is newest-first across all statuses and never exposes private storage keys', async () => {
  const [student] = await students(1); await enable(); const first = await submit(student); await new Promise(resolve => setTimeout(resolve, 5)); const second = await submit(student); await new Promise(resolve => setTimeout(resolve, 5)); const third = await submit(student);
  assert.equal((await review(first.id, 'APPROVED')).status, 200); assert.equal((await review(second.id, 'REJECTED')).status, 200);
  const queue = await fixture.request('GET', '/admin/memory-photos', { token: fixture.token });
  assert.equal(queue.status, 200); assert.deepEqual(queue.body.data.photos.map(photo => [photo.id, photo.status]), [
    [third.id, 'PENDING'], [first.id, 'APPROVED'],
  ]);
  for (const photo of queue.body.data.photos.filter(photo => photo.status !== 'PENDING')) {
    assert.match(String(photo.reviewedBy), /^[a-f0-9]{24}$/i); assert(Number.isFinite(Date.parse(photo.reviewedAt)));
  }
  assert.equal(JSON.stringify(queue.body).includes('imageKey'), false);
});

test('review decisions are atomic, record the actual reviewer once and reject malformed repeats', async () => {
  const [student] = await students(1); await enable(); const photo = await submit(student); const rejected = await submit(student);
  const moderator = await memoryAdmin(['memory.approve', 'memory.reject']);
  const decisions = await Promise.all([review(photo.id, 'APPROVED', moderator.token), review(photo.id, 'REJECTED', fixture.token)]);
  assert.equal(decisions.filter(response => response.status === 200).length, 1); assert.equal(decisions.filter(response => response.status === 409).length, 1);
  const winner = decisions.find(response => response.status === 200).body.data.photo;
  assert(['APPROVED', 'REJECTED'].includes(winner.status)); assert.match(String(winner.reviewedBy), /^[a-f0-9]{24}$/i); assert(Number.isFinite(Date.parse(winner.reviewedAt)));
  assert.equal((await review(photo.id, winner.status === 'APPROVED' ? 'REJECTED' : 'APPROVED')).status, 409);
  assert.equal((await review(rejected.id, 'REJECTED', moderator.token)).status, 200);
  assert.equal((await review(rejected.id, 'APPROVED', fixture.token)).status, 409);
  assert.equal((await review(photo.id, 'PENDING')).status, 400);
  assert.equal((await fixture.request('PATCH', `/admin/memory-photos/${photo.id}/review`, { token: fixture.token, body: { status: 'APPROVED', reviewedBy: 'client' } })).status, 400);
  assert.equal((await review('bad-id', 'APPROVED')).status, 400);
});

test('public gallery and image delivery expose only approved photos with bounded deterministic pagination', async () => {
  const [student] = await students(1); await enable(); const photos = [await submit(student), await submit(student), await submit(student)];
  assert.equal((await review(photos[0].id, 'APPROVED')).status, 200); assert.equal((await review(photos[1].id, 'REJECTED')).status, 200); assert.equal((await review(photos[2].id, 'APPROVED')).status, 200);
  const first = await fixture.request('GET', '/memory-photos?page=1&limit=1');
  assert.equal(first.status, 200); assert.equal(first.body.results, 1); assert.equal(first.body.pagination.hasMore, true);
  assert.deepEqual(Object.keys(first.body.data.photos[0]).sort(), ['createdAt', 'id', 'likeCount']);
  const second = await fixture.request('GET', '/memory-photos?page=2&limit=1'); assert.equal(second.status, 200); assert.notEqual(second.body.data.photos[0].id, first.body.data.photos[0].id);
  assert.equal((await fixture.request('GET', `/memory-photos/${photos[1].id}/image`)).status, 404);
  assert.equal((await fixture.request('GET', `/memory-photos/${photos[0].id}/image`)).status, 200);
  for (const query of ['page=0', 'limit=51', 'page=x', 'extra=1']) assert.equal((await fixture.request('GET', `/memory-photos?${query}`)).status, 400);
  assert.equal(JSON.stringify(first.body).includes('reviewedBy'), false); assert.equal(JSON.stringify(first.body).includes('imageKey'), false);
});

test('pending and rejected images remain uniformly unavailable to public and ordinary students', async () => {
  const [owner, other] = await students(2); await enable(); const pending = await submit(owner); const rejected = await submit(owner); assert.equal((await review(rejected.id, 'REJECTED')).status, 200);
  for (const photo of [pending, rejected]) {
    assert.equal((await fixture.request('GET', `/memory-photos/${photo.id}/image`)).status, 404);
    assert.equal((await fixture.request('GET', `/memory-photos/${photo.id}/image`, { token: owner.token })).status, 404);
    assert.equal((await fixture.request('GET', `/memory-photos/${photo.id}/image`, { token: other.token })).status, 404);
  }
});

test('likes and unlikes are idempotent, concurrency-safe and reflected in anonymous gallery counts', async () => {
  const [first, second] = await students(2); await enable(); const photo = await submit(first); assert.equal((await review(photo.id, 'APPROVED')).status, 200);
  const concurrent = await Promise.all(Array.from({ length: 20 }, () => fixture.request('POST', `/memory-photos/${photo.id}/like`, { token: first.token })));
  assert(concurrent.every(response => response.status === 200 && response.body.data.liked === true));
  assert.equal(await fixture.db.collection('memoryphotolikes').countDocuments({ photoId: new ObjectId(photo.id) }), 1);
  assert.equal((await fixture.request('POST', `/memory-photos/${photo.id}/like`, { token: second.token })).body.data.likeCount, 2);
  assert.equal((await fixture.request('DELETE', `/memory-photos/${photo.id}/like`, { token: first.token })).body.data.likeCount, 1);
  assert.equal((await fixture.request('DELETE', `/memory-photos/${photo.id}/like`, { token: first.token })).body.data.likeCount, 1);
  const gallery = await fixture.request('GET', '/memory-photos?page=1&limit=20'); assert.equal(gallery.body.data.photos[0].likeCount, 1);
  assert.equal(JSON.stringify(gallery.body).includes(first.user.id), false); assert.equal(JSON.stringify(gallery.body).includes(second.user.id), false);
});

test('like mutations require active students, approved photos and server-owned identity', async () => {
  const [student, other] = await students(2); await enable(); const pending = await submit(student);
  assert.equal((await fixture.request('POST', `/memory-photos/${pending.id}/like`, { token: student.token })).status, 404);
  assert.equal((await fixture.request('POST', '/memory-photos/bad/like', { token: student.token })).status, 400);
  assert.equal((await fixture.request('POST', `/memory-photos/${pending.id}/like`)).status, 401);
  assert.equal((await fixture.request('POST', `/memory-photos/${pending.id}/like`, { token: fixture.token })).status, 401);
  assert.equal((await review(pending.id, 'APPROVED')).status, 200);
  assert.equal((await fixture.request('POST', `/memory-photos/${pending.id}/like`, { token: student.token, body: { userId: other.user.id } })).status, 400);
  assert.equal(await fixture.db.collection('memoryphotolikes').countDocuments({}), 0);
  await fixture.db.collection('users').updateOne({ _id: new ObjectId(student.user.id) }, { $set: { status: 'disabled' } });
  assert.equal((await fixture.request('POST', `/memory-photos/${pending.id}/like`, { token: student.token })).status, 401, 'disabled users no longer have a valid student session');
});

test('like-status preserves request order, isolates students and omits every non-approved identity uniformly', async () => {
  const [first, second] = await students(2); await enable(); const approved = await submit(first); const pending = await submit(first); const rejected = await submit(first);
  assert.equal((await review(approved.id, 'APPROVED')).status, 200); assert.equal((await review(rejected.id, 'REJECTED')).status, 200);
  assert.equal((await fixture.request('POST', `/memory-photos/${approved.id}/like`, { token: first.token })).status, 200);
  const missing = String(new ObjectId());
  const firstStatus = await fixture.request('GET', `/memory-photos/like-status?photoIds=${approved.id},${pending.id},${rejected.id},${missing}`, { token: first.token });
  assert.equal(firstStatus.status, 200); assert.deepEqual(firstStatus.body.data.photos, [{ photoId: approved.id, liked: true }]);
  const secondStatus = await fixture.request('GET', `/memory-photos/like-status?photoIds=${approved.id}`, { token: second.token });
  assert.deepEqual(secondStatus.body.data.photos, [{ photoId: approved.id, liked: false }]); assert.match(secondStatus.headers.get('cache-control'), /private.*no-store/);
  for (const endpoint of [`/memory-photos/like-status?photoIds=${approved.id},${approved.id}`, '/memory-photos/like-status?photoIds=bad', `/memory-photos/like-status?photoIds=${approved.id}&userId=${first.user.id}`]) {
    assert.equal((await fixture.request('GET', endpoint, { token: first.token })).status, 400);
  }
});

test('approved owners can archive or delete only their own photos, while moderators can remove approved photos', async () => {
  const [owner, other] = await students(2); const moderator = await memoryAdmin(['memory.delete'], 'memory-delete'); await enable();
  const archived = await submit(owner); assert.equal((await review(archived.id, 'APPROVED')).status, 200);
  assert.equal((await fixture.request('PATCH', `/memory-photos/${archived.id}/archive`, { token: other.token })).status, 409);
  assert.equal((await fixture.request('PATCH', `/memory-photos/${archived.id}/archive`, { token: owner.token })).status, 200);
  assert.equal((await fixture.request('GET', `/memory-photos/mine/${archived.id}/image`, { token: owner.token })).status, 200);
  assert.equal((await fixture.request('GET', `/admin/memory-photos/${archived.id}/image`, { token: fixture.token })).status, 200);
  assert.equal((await fixture.request('GET', `/memory-photos/mine/${archived.id}/image`, { token: other.token })).status, 404);
  assert.equal((await fixture.request('GET', '/memory-photos?page=1&limit=20')).body.data.photos.some(photo => photo.id === archived.id), false);
  assert.equal((await fixture.request('GET', `/memory-photos/${archived.id}/image`)).status, 404);
  assert.equal((await fixture.request('POST', `/memory-photos/${archived.id}/like`, { token: other.token })).status, 404);
  assert.equal((await fixture.request('PATCH', `/memory-photos/${archived.id}/unarchive`, { token: owner.token })).status, 200);
  assert.equal((await fixture.request('GET', '/memory-photos?page=1&limit=20')).body.data.photos.some(photo => photo.id === archived.id), true);
  const deleted = await submit(owner); assert.equal((await review(deleted.id, 'APPROVED')).status, 200);
  assert.equal((await fixture.request('DELETE', `/memory-photos/${deleted.id}`, { token: other.token })).status, 409);
  assert.equal((await fixture.request('DELETE', `/memory-photos/${deleted.id}`, { token: owner.token })).status, 200);
  assert.equal((await fixture.request('GET', `/memory-photos/${deleted.id}/image`)).status, 404);
  const moderatorPhoto = await submit(owner); assert.equal((await review(moderatorPhoto.id, 'APPROVED')).status, 200);
  assert.equal((await fixture.request('DELETE', `/admin/memory-photos/${moderatorPhoto.id}`, { token: moderator.token })).status, 200);
  assert.equal((await fixture.request('GET', `/memory-photos/${moderatorPhoto.id}/image`)).status, 404);
});
