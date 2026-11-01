const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ObjectId } = require('mongoose').Types;
const { createV2Fixture } = require('./fixtures/v2Fixture.cjs');

let fixture;
before(async () => { fixture = await createV2Fixture(); }, { timeout: 60000 });
beforeEach(async () => { await fixture.reset(); }, { timeout: 60000 });
after(async () => { await fixture?.close(); }, { timeout: 30000 });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
async function settings(token) {
  const response = await fixture.request('GET', token ? '/admin/settings' : '/settings', { token });
  assert.equal(response.status, 200); return response.body.data;
}
async function command(action, token = fixture.token, body) {
  const payload = body || { revision: (await settings(token)).controls.revision, operationId: crypto.randomUUID() };
  return fixture.request('POST', `/admin/controls/${action}`, { token, body: payload });
}
async function lanternAdmin(permissions = [], username = `lantern-${crypto.randomBytes(4).toString('hex')}`) {
  return fixture.staff('lantern_admin', permissions, username);
}
async function students(count) {
  const accounts = [];
  for (let index = 0; index < count; index++) {
    accounts.push(await fixture.student(`lantern-student-${index}-${crypto.randomBytes(4).toString('hex')}@gmail.com`));
  }
  return accounts;
}
function lanternForm(title = 'Golden Lantern', description = 'Festival lantern') {
  const form = new FormData(); form.append('section', 'lantern'); form.append('title', title); form.append('description', description);
  form.append('images', new Blob([PNG], { type: 'image/png' }), 'lantern.png'); return form;
}
async function createLantern(token = fixture.token, title) {
  const response = await fixture.request('POST', '/images', { token, body: lanternForm(title) });
  assert.equal(response.status, 201); return response.body.data.images[0];
}
async function state() {
  const response = await fixture.request('GET', '/lantern-voting'); assert.equal(response.status, 200); return response.body.data;
}
const cast = (student, lanternId, window) => fixture.request('POST', '/lantern-voting', {
  token: student.token, body: { lanternId: String(lanternId), window },
});

test('ADMIN manages Lanterns; LANTERN_ADMIN manages only Lantern content without optional control grants', async () => {
  const lantern = await lanternAdmin();
  const voting = await fixture.staff('voting_admin', ['votes.read'], 'lantern-voting-role');
  const memory = await fixture.staff('memory_admin', ['memory.open'], 'lantern-memory-role');
  const student = (await students(1))[0];
  for (const token of [fixture.token, lantern.token]) {
    const created = await createLantern(token);
    assert.equal((await fixture.request('PATCH', `/images/${created._id}`, { token, body: { title: 'Updated title', description: 'Updated description' } })).status, 200);
  }
  for (const token of [voting.token, memory.token]) {
    assert.equal((await fixture.request('POST', '/images', { token, body: lanternForm('Forbidden') })).status, 403);
  }
  assert.equal((await fixture.request('POST', '/images', { token: student.token, body: lanternForm('Student') })).status, 401);
  assert.equal((await command('lantern.open', lantern.token)).status, 403, 'manage permission does not imply control permission');
  assert.equal((await fixture.request('GET', '/admin/lantern-vote-totals', { token: lantern.token })).status, 403);
});

test('Lantern creation validates image and metadata, stores a local image, edits metadata, and deletes unvoted content', async () => {
  const admin = await lanternAdmin(); const created = await createLantern(admin.token, '  Festival Light  ');
  assert.equal(created.title, 'Festival Light'); assert.equal(created.section, 'lantern');
  assert.match(created.url, /^\/uploads\/gallery\/lantern\/[A-Za-z0-9_-]+\.png$/);
  const image = await fixture.asset(created.url);
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png'); assert.deepEqual(await require('sharp')(image.bytes).raw().toBuffer(),await require('sharp')(PNG).raw().toBuffer());
  const edited = await fixture.request('PATCH', `/images/${created._id}`, { token: admin.token, body: { title: 'Paper Star', description: '' } });
  assert.equal(edited.status, 200); assert.equal(edited.body.data.image.title, 'Paper Star'); assert.equal(edited.body.data.image.description, '');
  const noOp = await fixture.request('PATCH', `/images/${created._id}`, { token: admin.token, body: {} });
  assert.equal(noOp.status, 200); assert.equal(noOp.body.data.image.title, 'Paper Star');
  for (const body of [{ title: '' }, { title: 'x', extra: true }, { description: 7 }]) {
    assert.equal((await fixture.request('PATCH', `/images/${created._id}`, { token: admin.token, body })).status, 400);
  }
  const missingImage = new FormData(); missingImage.append('section', 'lantern'); missingImage.append('title', 'No photo');
  assert.equal((await fixture.request('POST', '/images', { token: admin.token, body: missingImage })).status, 400);
  const wrongType = new FormData(); wrongType.append('section', 'lantern'); wrongType.append('title', 'Text'); wrongType.append('images', new Blob(['text'], { type: 'text/plain' }), 'bad.txt');
  assert.equal((await fixture.request('POST', '/images', { token: admin.token, body: wrongType })).status, 400);
  assert.equal((await fixture.request('DELETE', `/images/${created._id}`, { token: admin.token })).status, 204);
  assert.equal(await fixture.db.collection('images').countDocuments({ _id: new ObjectId(created._id) }), 0);
  assert.equal((await fixture.asset(created.url)).status, 404, 'deleting an unvoted Lantern also removes its owned local image');
});

test('LANTERN_ADMIN is restricted to the lantern section while ADMIN retains other gallery management', async () => {
  const admin = await lanternAdmin();
  const other = new FormData(); other.append('section', 'memory'); other.append('images', new Blob([PNG], { type: 'image/png' }), 'memory.png');
  assert.equal((await fixture.request('POST', '/images', { token: admin.token, body: other })).status, 403);
  const rootForm = new FormData(); rootForm.append('section', 'memory'); rootForm.append('images', new Blob([PNG], { type: 'image/png' }), 'memory.png');
  const rootCreated = await fixture.request('POST', '/images', { token: fixture.token, body: rootForm });
  assert.equal(rootCreated.status, 201);
  assert.equal((await fixture.request('PATCH', `/images/${rootCreated.body.data.images[0]._id}`, { token: admin.token, body: { title: 'No escalation' } })).status, 400);
  assert.equal((await fixture.request('DELETE', `/images/${rootCreated.body.data.images[0]._id}`, { token: admin.token })).status, 403);
});

test('manual Lantern controls require optional grants and preserve public state transitions', async () => {
  const denied = await lanternAdmin([]); const allowed = await lanternAdmin(['lantern.open', 'lantern.close', 'lantern.announce', 'lantern.hide']);
  for (const action of ['lantern.open', 'lantern.close', 'lantern.announce', 'lantern.hide']) assert.equal((await command(action, denied.token)).status, 403);
  const initial = await state(); assert.equal(initial.open, false); assert.equal(initial.announced, false); assert.equal(initial.window, 0);
  assert.equal((await command('lantern.open', allowed.token)).status, 200);
  const opened = await state(); assert.equal(opened.open, true); assert.equal(opened.window, 1);
  assert.equal((await command('lantern.announce', allowed.token)).status, 409, 'announcement requires closed voting');
  assert.equal((await command('lantern.close', allowed.token)).status, 200);
  assert.equal((await command('lantern.announce', allowed.token)).status, 409, 'announcement requires at least one vote');
});

test('a student has one permanent Lantern vote; same-selection retries are idempotent and changes are rejected', async () => {
  const [student] = await students(1); const first = await createLantern(); const second = await createLantern();
  assert.equal((await command('lantern.open')).status, 200); const opened = await state();
  assert.equal((await cast(student, first._id, opened.window)).status, 200);
  assert.equal((await cast(student, first._id, opened.window)).status, 200);
  assert.equal((await cast(student, second._id, opened.window)).status, 409);
  assert.equal(await fixture.db.collection('lanternvotes').countDocuments({}), 1);
  const mine = await fixture.request('GET', '/lantern-voting/mine', { token: student.token });
  assert.equal(mine.status, 200); assert.equal(mine.body.data.vote.lantern, first._id);
});

test('concurrent duplicate submissions produce one permanent vote and stale windows reject new voters', async () => {
  const [student, staleStudent] = await students(2); const lantern = await createLantern();
  assert.equal((await command('lantern.open')).status, 200); const first = await state();
  const duplicate = await Promise.all(Array.from({ length: 8 }, () => cast(student, lantern._id, first.window)));
  assert(duplicate.every(response => response.status === 200));
  assert.equal(await fixture.db.collection('lanternvotes').countDocuments({}), 1);
  assert.equal((await command('lantern.close')).status, 200);
  assert.equal((await cast(staleStudent, lantern._id, first.window)).status, 409);
  assert.equal((await command('lantern.open')).status, 200); const second = await state();
  assert.equal(second.window, first.window + 1);
  assert.equal((await cast(staleStudent, lantern._id, first.window)).status, 409);
  assert.equal((await cast(staleStudent, lantern._id, second.window)).status, 200);
  assert.equal((await cast(student, lantern._id, second.window)).status, 200, 'a recorded same-selection vote remains idempotent across windows');
  assert.equal(await fixture.db.collection('lanternvotes').countDocuments({}), 2);
});

test('Lantern edits and deletion are blocked during voting or announcement, and voted Lanterns remain undeletable', async () => {
  const [student] = await students(1); const lantern = await createLantern();
  assert.equal((await command('lantern.open')).status, 200); const opened = await state();
  assert.equal((await fixture.request('PATCH', `/images/${lantern._id}`, { token: fixture.token, body: { title: 'Blocked' } })).status, 409);
  assert.equal((await fixture.request('DELETE', `/images/${lantern._id}`, { token: fixture.token })).status, 409);
  assert.equal((await cast(student, lantern._id, opened.window)).status, 200);
  assert.equal((await command('lantern.close')).status, 200); assert.equal((await command('lantern.announce')).status, 200);
  assert.equal((await fixture.request('PATCH', `/images/${lantern._id}`, { token: fixture.token, body: { title: 'Still blocked' } })).status, 409);
  assert.equal((await fixture.request('DELETE', `/images/${lantern._id}`, { token: fixture.token })).status, 409);
  assert.equal((await command('lantern.hide')).status, 200);
  assert.equal((await fixture.request('PATCH', `/images/${lantern._id}`, { token: fixture.token, body: { title: 'Editable again' } })).status, 200);
  assert.equal((await fixture.request('DELETE', `/images/${lantern._id}`, { token: fixture.token })).status, 409, 'recorded votes permanently protect their Lantern');
});

test('winner announcement rejects ties, exposes one winner after resolution, and hiding preserves votes', async () => {
  const voters = await students(3); const first = await createLantern(); const second = await createLantern();
  assert.equal((await command('lantern.open')).status, 200); const opened = await state();
  assert.equal((await cast(voters[0], first._id, opened.window)).status, 200);
  assert.equal((await cast(voters[1], second._id, opened.window)).status, 200);
  assert.equal((await command('lantern.close')).status, 200);
  assert.equal((await command('lantern.announce')).status, 409);
  assert.equal((await command('lantern.open')).status, 200); const reopened = await state();
  assert.equal((await cast(voters[2], first._id, reopened.window)).status, 200);
  assert.equal((await command('lantern.close')).status, 200); assert.equal((await command('lantern.announce')).status, 200);
  const announced = await state(); assert.equal(announced.announced, true); assert.equal(announced.winner.lantern._id, first._id); assert.equal(announced.winner.votes, 2);
  assert.equal((await command('lantern.open')).status, 409, 'announcement must be hidden before reopening');
  assert.equal((await command('lantern.hide')).status, 200); assert.equal((await state()).announced, false);
  assert.equal(await fixture.db.collection('lanternvotes').countDocuments({}), 3);
});

test('private Lantern totals require lantern.votes.read and never expose voter identities', async () => {
  const reader = await lanternAdmin(['lantern.votes.read']); const nonreader = await lanternAdmin([]);
  const voting = await fixture.staff('voting_admin', ['votes.read'], 'totals-voting-role'); const memory = await fixture.staff('memory_admin', ['memory.open'], 'totals-memory-role');
  const [student] = await students(1); const lantern = await createLantern(); assert.equal((await command('lantern.open')).status, 200);
  assert.equal((await cast(student, lantern._id, (await state()).window)).status, 200);
  for (const token of [fixture.token, reader.token]) {
    const totals = await fixture.request('GET', '/admin/lantern-vote-totals', { token }); assert.equal(totals.status, 200);
    assert.equal(totals.body.data.entries[0].votes, 1); assert.equal(Object.hasOwn(totals.body.data.entries[0], 'user'), false);
  }
  for (const token of [nonreader.token, voting.token, memory.token, student.token]) {
    const response = await fixture.request('GET', '/admin/lantern-vote-totals', { token });
    assert.equal(response.status, token === student.token ? 401 : 403);
  }
});

test('failed Lantern metadata transactions roll back both content and shared control fencing', async () => {
  const lantern = await createLantern(); const before = (await settings(fixture.token)).controls;
  await fixture.db.command({ collMod: 'images', validator: { fixtureMustNotExist: { $exists: true } }, validationLevel: 'strict' });
  try {
    const failed = await fixture.request('PATCH', `/images/${lantern._id}`, { token: fixture.token, body: { title: 'Must roll back' } });
    assert.equal(failed.status, 500);
  } finally {
    await fixture.db.command({ collMod: 'images', validator: {}, validationLevel: 'off' });
  }
  const saved = await fixture.db.collection('images').findOne({ _id: new ObjectId(lantern._id) });
  assert.equal(saved.title, lantern.title);
  const afterState = (await settings(fixture.token)).controls;
  assert.equal(afterState.revision, before.revision); assert.equal(afterState.lanternVotingOpen, false);
});
