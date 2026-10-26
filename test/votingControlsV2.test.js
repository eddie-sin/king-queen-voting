const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ObjectId } = require('mongoose').Types;
const { createV2Fixture } = require('./fixtures/v2Fixture.cjs');

let fixture;
before(async () => { fixture = await createV2Fixture(); }, { timeout: 60000 });
beforeEach(async () => { await fixture.reset(); }, { timeout: 60000 });
after(async () => { await fixture?.close(); }, { timeout: 30000 });

async function controls(token) {
  const result = await fixture.request('GET', token ? '/admin/settings' : '/settings', { token });
  assert.equal(result.status, 200);
  return result.body.data;
}
async function command(action, token = fixture.token, body) {
  const payload = body || { revision: (await controls(token)).controls.revision, operationId: crypto.randomUUID() };
  return { payload, response: await fixture.request('POST', `/admin/controls/${action}`, { token, body: payload }) };
}
async function votingAdmin(permissions) {
  return fixture.staff('voting_admin', permissions, `voter-${crypto.randomBytes(4).toString('hex')}`);
}
async function students(count) {
  const values = [];
  for (let index = 0; index < count; index++) {
    values.push(await fixture.student(`v2-voter-${index}-${crypto.randomBytes(4).toString('hex')}@gmail.com`));
  }
  return values;
}
async function candidates(specification = [['king', true], ['queen', true]]) {
  const docs = specification.map(([category, isActive], index) => ({
    _id: new ObjectId(), fullName: `${category}-${index}-${crypto.randomBytes(3).toString('hex')}`,
    images: [`/test/${category}-${index}.png`], category, isActive,
  }));
  await fixture.db.collection('candidates').insertMany(docs);
  return docs.map(doc => ({ ...doc, id: String(doc._id) }));
}
async function openVoting(token = fixture.token) {
  const opened = await command('voting.open', token); assert.equal(opened.response.status, 200);
  return opened.response.body.data.controls;
}
const vote = (student, candidate, contest, state) => fixture.request('POST', '/voting/submit', {
  token: student.token, body: { candidateId: candidate.id, contest, round: state.round, window: state.window },
});

test('registration, voting and announcement controls require ADMIN or explicit VOTING_ADMIN grants', async () => {
  const denied = await votingAdmin([]);
  const allowed = await votingAdmin(['registration.open', 'registration.close', 'voting.open', 'voting.close', 'announcement.open', 'announcement.close']);
  for (const action of ['registration.open', 'voting.open', 'announcement.open']) {
    assert.equal((await command(action, denied.token)).response.status, 403, action);
  }
  assert.equal((await command('registration.open', allowed.token)).response.status, 200);
  assert.equal((await controls()).controls.registrationOpen, true);
  assert.equal((await command('registration.close', allowed.token)).response.status, 200);
  assert.equal((await command('voting.open', allowed.token)).response.status, 200);
  assert.equal((await command('announcement.open', allowed.token)).response.status, 409, 'announcement cannot open while voting is open');
  assert.equal((await command('voting.close', allowed.token)).response.status, 200);
  assert.equal((await command('announcement.open', allowed.token)).response.status, 200);
  assert.equal((await command('voting.open', allowed.token)).response.status, 409, 'voting cannot reopen while announcement is visible');
  assert.equal((await command('announcement.close', allowed.token)).response.status, 200);
});

test('revisions reject stale commands and operationId retries are actor/action-bound and idempotent', async () => {
  const admin = await votingAdmin(['registration.open', 'registration.close']);
  const initial = (await controls(admin.token)).controls;
  const operationId = crypto.randomUUID();
  const payload = { revision: initial.revision, operationId };
  const first = await command('registration.open', admin.token, payload);
  assert.equal(first.response.status, 200); assert.equal(first.response.body.data.controls.revision, initial.revision + 1);
  const replay = await command('registration.open', admin.token, payload);
  assert.equal(replay.response.status, 200); assert.equal(replay.response.body.data.controls.revision, initial.revision + 1);
  assert.equal((await command('registration.close', admin.token, payload)).response.status, 409, 'operationId cannot change actions');
  assert.equal((await command('registration.close', admin.token, { revision: initial.revision, operationId: crypto.randomUUID() })).response.status, 409);
  const other = await votingAdmin(['registration.open']);
  assert.equal((await command('registration.open', other.token, payload)).response.status, 409, 'receipt cannot be replayed by another actor');
  assert.equal(await fixture.db.collection('adminactions').countDocuments({ operationId }), 1);
});

test('each student gets one final King and Queen vote per round; exact retries are harmless', async () => {
  const [student] = await students(1);
  const [king, queen, otherKing] = await candidates([['king', true], ['queen', true], ['king', true]]);
  const state = await openVoting();
  assert.equal((await vote(student, king, 'king', state)).status, 201);
  const retry = await vote(student, king, 'king', state);
  assert.equal(retry.status, 200); assert.equal(retry.body.data.alreadyRecorded, true);
  assert.equal((await vote(student, otherKing, 'king', state)).status, 409, 'recorded votes cannot be changed');
  assert.equal((await vote(student, queen, 'queen', state)).status, 201);
  assert.equal(await fixture.db.collection('ballots').countDocuments({ user: new ObjectId(student.user.id), round: state.round }), 2);
  const mine = await fixture.request('GET', '/voting/my-votes', { token: student.token });
  assert.equal(mine.status, 200); assert.deepEqual(mine.body.data.votes.map(entry => entry.contest).sort(), ['king', 'queen']);
});

test('malformed, inactive, missing and wrong-category candidates cannot create ballots', async () => {
  const [student] = await students(1);
  const [king, inactiveQueen] = await candidates([['king', true], ['queen', false]]);
  const state = await openVoting();
  const bodies = [
    {}, { candidateId: 'bad', contest: 'king', round: state.round, window: state.window },
    { candidateId: king.id, contest: 'prince', round: state.round, window: state.window },
    { candidateId: king.id, contest: 'queen', round: state.round, window: state.window },
    { candidateId: inactiveQueen.id, contest: 'queen', round: state.round, window: state.window },
    { candidateId: String(new ObjectId()), contest: 'king', round: state.round, window: state.window },
    { candidateId: king.id, contest: 'king', round: state.round, window: state.window, userId: student.user.id },
  ];
  for (const body of bodies) {
    const response = await fixture.request('POST', '/voting/submit', { token: student.token, body });
    assert([400, 409].includes(response.status), JSON.stringify(body));
  }
  assert.equal(await fixture.db.collection('ballots').countDocuments({}), 0);
});

test('concurrent duplicate and competing votes cannot exceed one ballot for a contest', async () => {
  const [student] = await students(1); const [first, second] = await candidates([['king', true], ['king', true]]); const state = await openVoting();
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => vote(student, first, 'king', state)));
  assert.equal(duplicates.filter(response => response.status === 201).length, 1);
  assert.equal(duplicates.filter(response => response.status === 200).length, 7);
  assert.equal(await fixture.db.collection('ballots').countDocuments({ contest: 'king', round: state.round }), 1);
  await command('voting.close');
  const cleared = await command('votes.clear', fixture.token, { revision: (await controls()).controls.revision, operationId: crypto.randomUUID(), confirmation: 'CLEAR ALL VOTES' });
  assert.equal(cleared.response.status, 200);
  const reopened = await openVoting();
  const competing = await Promise.all([vote(student, first, 'king', reopened), vote(student, second, 'king', reopened)]);
  assert.equal(competing.filter(response => response.status === 201).length, 1);
  assert.equal(competing.filter(response => response.status === 409).length, 1);
  assert.equal(await fixture.db.collection('ballots').countDocuments({ contest: 'king', round: reopened.round }), 1);
});

test('closing blocks new votes, reopening changes the window, and stale window/round submissions fail', async () => {
  const [student] = await students(1); const [king] = await candidates([['king', true]]); const first = await openVoting();
  assert.equal((await command('voting.close')).response.status, 200);
  assert.equal((await vote(student, king, 'king', first)).status, 409);
  const second = await openVoting();
  assert.equal(second.round, first.round); assert.equal(second.window, first.window + 1);
  assert.equal((await vote(student, king, 'king', first)).status, 409, 'old window is stale after reopening');
  assert.equal((await vote(student, king, 'king', { round: first.round + 1, window: second.window })).status, 409);
  assert.equal((await vote(student, king, 'king', second)).status, 201);
});

test('vote clearing advances the round and a receipt retry never deletes newer ballots', async () => {
  const admin = await votingAdmin(['voting.open', 'voting.close', 'votes.clear', 'votes.read']);
  const [student] = await students(1); const [king] = await candidates([['king', true]]); const first = await openVoting(admin.token);
  assert.equal((await vote(student, king, 'king', first)).status, 201);
  assert.equal((await command('voting.close', admin.token)).response.status, 200);
  const clearPayload = { revision: (await controls(admin.token)).controls.revision, operationId: crypto.randomUUID(), confirmation: 'CLEAR ALL VOTES' };
  const cleared = await command('votes.clear', admin.token, clearPayload);
  assert.equal(cleared.response.status, 200); assert.equal(cleared.response.body.data.clearedBallots, 1);
  assert.equal(cleared.response.body.data.controls.round, first.round + 1);
  const second = await openVoting(admin.token); assert.equal((await vote(student, king, 'king', second)).status, 201);
  const replay = await command('votes.clear', admin.token, clearPayload);
  assert.equal(replay.response.status, 200); assert.equal(replay.response.body.data.clearedBallots, 1);
  assert.equal(await fixture.db.collection('ballots').countDocuments({ round: second.round }), 1, 'receipt replay preserves later-round ballots');
});

test('private totals and ballotCount are visible only to ADMIN or VOTING_ADMIN with votes.read', async () => {
  const reader = await votingAdmin(['votes.read']); const nonreader = await votingAdmin(['registration.open']);
  const memory = await fixture.staff('memory_admin', ['memory.open'], 'privacy-memory');
  const [student] = await students(1); const [king] = await candidates([['king', true]]); const state = await openVoting();
  assert.equal((await vote(student, king, 'king', state)).status, 201);
  for (const token of [fixture.token, reader.token]) {
    const settings = await controls(token); assert.equal(settings.ballotCount, 1);
    const totals = await fixture.request('GET', '/admin/vote-totals', { token });
    assert.equal(totals.status, 200); assert.equal(totals.body.data.entries[0].votes, 1);
  }
  for (const token of [nonreader.token, memory.token]) {
    assert.deepEqual(Object.keys(await controls(token)), ['controls']);
    assert.equal((await fixture.request('GET', '/admin/vote-totals', { token })).status, 403);
  }
  assert.deepEqual(Object.keys(await controls()), ['controls']);
});

test('announcements reject unresolved title ties and return ranked King/Queen results when resolved', async () => {
  const voters = await students(4);
  const [kingA, kingB, queenA, queenB] = await candidates([['king', true], ['king', true], ['queen', true], ['queen', true]]);
  const state = await openVoting();
  assert.equal((await vote(voters[0], kingA, 'king', state)).status, 201);
  assert.equal((await vote(voters[1], kingB, 'king', state)).status, 201);
  assert.equal((await vote(voters[0], queenA, 'queen', state)).status, 201);
  assert.equal((await vote(voters[1], queenB, 'queen', state)).status, 201);
  assert.equal((await command('voting.close')).response.status, 200);
  assert.equal((await command('announcement.open')).response.status, 409, 'top-title ties must be resolved');

  // Resolve both ties through additional immutable student ballots in a new window of the same round.
  const reopened = await openVoting();
  assert.equal((await vote(voters[2], kingA, 'king', reopened)).status, 201);
  assert.equal((await vote(voters[2], queenA, 'queen', reopened)).status, 201);
  assert.equal((await command('voting.close')).response.status, 200);
  assert.equal((await command('announcement.open')).response.status, 200);
  const result = await fixture.request('GET', '/results');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.results.kings.map(row => [row.candidate.fullName, row.votes]), [[kingA.fullName, 2], [kingB.fullName, 1]]);
  assert.deepEqual(result.body.data.results.queens.map(row => [row.candidate.fullName, row.votes]), [[queenA.fullName, 2], [queenB.fullName, 1]]);
  assert.deepEqual(result.body.data.results.queens.map(row => row.title), ['Miss Thadingyut', 'Princess']);
  assert.deepEqual(result.body.data.results.kings.map(row => row.title), ['Mrs Thadingyut', 'Prince']);
  assert.equal(result.body.data.results.round, state.round);
});

test('failed control transactions roll back state and audit records', async () => {
  const before = (await controls(fixture.token)).controls; const operationId = crypto.randomUUID();
  await fixture.db.command({ collMod: 'eventcontrols', validator: { fixtureMustNotExist: { $exists: true } }, validationLevel: 'strict' });
  try {
    const failed = await command('registration.open', fixture.token, { revision: before.revision, operationId });
    assert.equal(failed.response.status, 500);
  } finally {
    await fixture.db.command({ collMod: 'eventcontrols', validator: {}, validationLevel: 'off' });
  }
  const afterState = (await controls(fixture.token)).controls;
  assert.equal(afterState.registrationOpen, before.registrationOpen); assert.equal(afterState.revision, before.revision);
  assert.equal(await fixture.db.collection('adminactions').countDocuments({ operationId }), 0);
});

test('restart closes an open voting window without losing accepted ballots or advancing the round', async () => {
  const rootToken = fixture.token; const [student] = await students(1); const [king] = await candidates([['king', true]]); const state = await openVoting();
  assert.equal((await vote(student, king, 'king', state)).status, 201);
  await fixture.restart();
  const restarted = (await controls(rootToken)).controls;
  assert.equal(restarted.votingStatus, 'closed'); assert.equal(restarted.round, state.round); assert.equal(restarted.window, state.window);
  assert(restarted.revision > state.revision);
  assert.equal(await fixture.db.collection('ballots').countDocuments({ round: state.round }), 1);
  assert.equal((await vote(student, king, 'king', state)).status, 409);
});
