import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.js';
import { announcementState, publicResults } from '../src/domain.js';

test('results remain hidden until administrators explicitly announce after voting closes', () => {
  assert.equal(announcementState({ votingStatus: 'open', announcementOpen: false }), 'waiting');
  assert.equal(announcementState({ votingStatus: 'closed', announcementOpen: false }), 'waiting');
  assert.equal(announcementState({ votingStatus: 'open', announcementOpen: true }), 'waiting');
  assert.equal(announcementState({ votingStatus: 'closed', announcementOpen: true }), 'announced');
  assert.equal(announcementState(null), 'unknown');
});

test('public announced results retain official totals and titles while stripping private candidate fields', () => {
  const entry = (id, name, votes, title) => ({ candidate: { _id: id, fullName: name, category: 'king', images: ['/uploads/a.jpg'], isActive: true, contactNumber: 'PRIVATE' }, votes, title });
  const result = publicResults({ round: 2, revision: 4, kings: [entry('z', 'Zaw', 2, '1st Runner-up'), entry('a', 'Aung', 5, 'King')], queens: [] });
  assert.deepEqual(result.king.map(person => [person.fullName, person.votes, person.title]), [['Aung', 5, 'King'], ['Zaw', 2, '1st Runner-up']]);
  const text = JSON.stringify(result);
  assert.equal(text.includes('PRIVATE'), false);
  assert.deepEqual(result.queen, []);
  assert.throws(() => publicResults(null));
});

test('results API reads /results and validates the current round/revision shape', async () => {
  const seen = [];
  const api = createApi({ fetchImpl: async url => { seen.push(url); return new Response(JSON.stringify({ status: 'success', data: { results: {
    round: 3, revision: 7,
    kings: [{ candidate: { _id: 'k1', fullName: 'Kyaw', category: 'king', isActive: true, images: [] }, votes: 3, title: 'King' }], queens: [],
  } } })); } });
  const result = await api.results();
  assert.equal(seen[0], '/api/v1/results');
  assert.equal(result.king[0].fullName, 'Kyaw');
  assert.equal(result.king[0].votes, 3);
  assert.equal(result.round, 3); assert.equal(result.revision, 7);
});
