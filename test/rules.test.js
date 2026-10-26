const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventControls = require('../model/eventControlsModel');
const Ballot = require('../model/ballotsModel');
const { awards } = require('../utils/voteTotals');
const { can, ROLE_PERMISSIONS } = require('../utils/permissions');

test('v2 event controls start closed and keep announcements incompatible with open voting', async () => {
  const controls = new EventControls();
  assert.equal(controls.schemaVersion, 2);
  assert.equal(controls.registrationOpen, false);
  assert.equal(controls.votingStatus, 'closed');
  assert.equal(controls.announcementOpen, false);
  assert.equal(controls.round, 1);
  assert.equal(controls.window, 0);
  controls.votingStatus = 'open'; controls.announcementOpen = true;
  await assert.rejects(controls.validate(), { name: 'ValidationError' });
});

test('ballot schema enforces one candidate, contest and round with a unique final-vote index', async () => {
  const indexes = Ballot.schema.indexes();
  assert(indexes.some(([keys, options]) => keys.round === 1 && keys.user === 1 && keys.contest === 1 && options.unique === true));
  await assert.rejects(new Ballot({ contest: 'king', round: 1 }).validate(), { name: 'ValidationError' });
  await assert.rejects(new Ballot({ user: '507f1f77bcf86cd799439011', candidate: '507f191e810c19729de860ea', contest: 'prince', round: 1 }).validate(), { name: 'ValidationError' });
  await assert.rejects(new Ballot({ user: '507f1f77bcf86cd799439011', candidate: '507f191e810c19729de860ea', contest: 'queen', round: 0 }).validate(), { name: 'ValidationError' });
});

test('ADMIN receives every voting capability while VOTING_ADMIN needs each explicit grant', () => {
  const root = { role: 'admin', status: 'active', permissions: [] };
  const delegated = { role: 'voting_admin', status: 'active', permissions: ['votes.read', 'voting.open'] };
  for (const permission of ROLE_PERMISSIONS.voting_admin) assert.equal(can(root, permission), true);
  assert.equal(can(delegated, 'candidates.read'), true);
  assert.equal(can(delegated, 'votes.read'), true);
  assert.equal(can(delegated, 'voting.open'), true);
  assert.equal(can(delegated, 'voting.close'), false);
  assert.equal(can({ ...delegated, status: 'disabled' }, 'votes.read'), false);
  assert.equal(can({ role: 'memory_admin', status: 'active', permissions: ['memory.open'] }, 'votes.read'), false);
});

test('results omit zero-vote candidates and calculate both ranked titles deterministically', () => {
  const rows = [
    { candidate: { category: 'king', fullName: 'King A' }, votes: 5 },
    { candidate: { category: 'king', fullName: 'King B' }, votes: 2 },
    { candidate: { category: 'king', fullName: 'King Zero' }, votes: 0 },
    { candidate: { category: 'queen', fullName: 'Queen A' }, votes: 4 },
    { candidate: { category: 'queen', fullName: 'Queen B' }, votes: 1 },
  ];
  const result = awards(rows);
  assert.deepEqual(result.kings.map(row => [row.candidate.fullName, row.votes, row.title]), [['King A', 5, 'Mrs Thadingyut'], ['King B', 2, 'Prince']]);
  assert.deepEqual(result.queens.map(row => [row.candidate.fullName, row.votes, row.title]), [['Queen A', 4, 'Miss Thadingyut'], ['Queen B', 1, 'Princess']]);
});

test('ties affecting either title position block announcement calculations', () => {
  const candidate = (category, name) => ({ category, fullName: name });
  for (const rows of [
    [{ candidate: candidate('king', 'A'), votes: 2 }, { candidate: candidate('king', 'B'), votes: 2 }],
    [{ candidate: candidate('queen', 'A'), votes: 3 }, { candidate: candidate('queen', 'B'), votes: 2 }, { candidate: candidate('queen', 'C'), votes: 2 }],
  ]) assert.throws(() => awards(rows), { statusCode: 409 });
});

test('a clear winner with a tie below the two title positions remains announceable', () => {
  const rows = [5, 4, 1, 1].map((votes, index) => ({ candidate: { category: 'king', fullName: `King ${index}` }, votes }));
  assert.deepEqual(awards(rows).kings.map(row => row.votes), [5, 4]);
  assert.deepEqual(awards([]), { kings: [], queens: [] });
});
