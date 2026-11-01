const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ObjectId } = require('mongoose').Types;
const { createV2Fixture } = require('./fixtures/v2Fixture.cjs');
const rows = [ ['king', 9], ['king', 4], ['king', 4], ['queen', 8], ['queen', 3], ['queen', 0] ].map(([category, votes], i) => ({ candidate: { _id: String(i + 1).padStart(24, '0'), category, fullName: `Candidate ${i + 1}`, isActive: true }, votes }));

let f;
before(async () => { f = await createV2Fixture(); }, { timeout: 60000 });
beforeEach(async () => { await f.reset(); }, { timeout: 60000 });
after(async () => { await f?.close(); }, { timeout: 30000 });
async function seed() {
  await f.db.collection('candidates').insertMany(rows.map(r => ({ ...r.candidate, _id: new ObjectId(r.candidate._id), images: ['/test/portrait.png'], contactNumber: 'PRIVATE-CONTACT' })));
  const ballots = rows.flatMap(row => Array.from({ length: row.votes }, () => ({ _id: new ObjectId(), user: new ObjectId(), candidate: new ObjectId(row.candidate._id), contest: row.candidate.category, round: 1 })));
  await f.db.collection('ballots').insertMany(ballots);
}
const preview = token => f.request('GET', '/admin/announcement-preview', { token });
const defaultPick = { mode: 'default', picks: { mrs: rows[1].candidate._id } };
const manualPick = { mode: 'manual', picks: { king: rows[2].candidate._id, mrs: rows[0].candidate._id, queen: rows[5].candidate._id, miss: rows[3].candidate._id } };
test('preview is scoped to an authorised announcer while closed and hidden; public and general totals stay private', async () => {
  await seed();
  const announcer = await f.staff('voting_admin', ['announcement.open'], 'award-announcer');
  const reader = await f.staff('voting_admin', ['votes.read'], 'award-reader');
  for (const token of [undefined, reader.token]) assert.equal((await preview(token)).status, token ? 403 : 401);
  const result = await preview(announcer.token); assert.equal(result.status, 200); assert.equal(result.body.data.entries.length, 6);
  assert.equal(JSON.stringify(result.body).includes('PRIVATE-CONTACT'), false);
  assert.equal((await f.request('GET', '/admin/vote-totals', { token: announcer.token })).status, 403);
  assert.equal((await f.request('GET', '/results')).status, 403);
  await f.command('voting.open'); assert.equal((await preview(announcer.token)).status, 409);
  await f.command('voting.close');
  assert.equal((await f.command('announcement.open', announcer.token, { awardSelection: defaultPick })).status, 200);
  assert.equal((await preview(announcer.token)).status, 409);
  for (const path of ['/settings', '/admin/settings']) {
    const settings = await f.request('GET', path, { token: path.startsWith('/admin') ? announcer.token : undefined });
    assert.equal(JSON.stringify(settings.body).includes('announcedAwards'), false);
    assert.equal(JSON.stringify(settings.body).includes('PRIVATE-CONTACT'), false);
  }
});
test('manual publication survives restart, is immutable while visible, and closing allows fresh choices', async () => {
  await seed();
  const announcer = await f.staff('voting_admin', ['announcement.open', 'announcement.close'], 'flexible-announcer');
  const before = await preview(announcer.token); const operationId = crypto.randomUUID();
  const payload = { revision: before.body.data.revision, operationId, awardSelection: manualPick };
  const publish = () => f.request('POST', '/admin/controls/announcement.open', { token: announcer.token, body: payload });
  assert.equal((await publish()).status, 200); assert.equal((await publish()).status, 200);
  assert.equal((await f.request('POST', '/admin/controls/announcement.open', { token: announcer.token, body: { ...payload, awardSelection: defaultPick } })).status, 409, 'a receipt cannot be reused for different choices');
  assert.equal((await f.command('announcement.open', announcer.token, { awardSelection: defaultPick })).status, 409);
  await f.restart();
  let result = await f.request('GET', '/results'); assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.results.kings.map(r => [r.candidate._id, r.votes, r.title]), [[rows[2].candidate._id, 4, 'King'], [rows[0].candidate._id, 9, 'Mrs Thadingyut']]);
  assert.deepEqual(result.body.data.results.queens.map(r => r.title), ['Queen', 'Miss Thadingyut']);
  const receipt = await f.db.collection('adminactions').findOne({ operationId }); assert.equal(receipt.details.awards.picks.king, manualPick.picks.king);
  await f.command('announcement.close', announcer.token); assert.equal((await f.request('GET', '/results')).status, 403);
  assert.equal((await f.db.collection('eventcontrols').findOne({ _id: 'event' })).announcedAwards, undefined);
  assert.equal((await publish()).status, 200, 'old receipt must not re-publish after closing');
  assert.equal((await f.request('GET', '/results')).status, 403);
  assert.equal((await f.command('announcement.open', announcer.token)).status, 409, 'a fresh default attempt still needs tie selection');
  assert.equal((await f.command('announcement.open', announcer.token, { awardSelection: defaultPick })).status, 200);
  result = await f.request('GET', '/results'); assert.equal(result.body.data.results.kings[0].candidate._id, rows[0].candidate._id);
  assert.equal(await f.db.collection('ballots').countDocuments({}), 28, 'announcing never changes the ballots');
});
test('stale previews, malformed payloads and revoked permissions cannot publish', async () => {
  await seed(); const staff = await f.staff('voting_admin', ['announcement.open'], 'stale-announcer');
  const captured = await preview(staff.token);
  await f.command('registration.open');
  assert.equal((await f.command('announcement.open', staff.token, { revision: captured.body.data.revision, awardSelection: defaultPick })).status, 409);
  for (const awardSelection of [{ mode: 'manual', picks: { ...manualPick.picks, mrs: manualPick.picks.king } }, { mode: 'default', picks: { queen: manualPick.picks.king } }, { mode: 'other', picks: {} }, { mode: 'manual', picks: { king: { $ne: null } } }, { mode: 'default', picks: {}, secret: true }]) {
    const response = await f.command('announcement.open', staff.token, { awardSelection }); assert([400, 409].includes(response.status));
  }
  await f.db.collection('admins').updateOne({ username: 'stale-announcer' }, { $set: { permissions: [] } });
  assert.equal((await preview(staff.token)).status, 403);
  assert.equal((await f.command('announcement.open', staff.token, { awardSelection: defaultPick })).status, 403);
});
