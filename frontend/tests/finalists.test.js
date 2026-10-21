import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.js';
import { finalistsState, publicFinalists } from '../src/domain.js';

const schedule = {
  votingOpensAt: '2026-10-28T02:30:00Z', votingClosesAt: '2026-11-01T17:29:59Z', resultsPublishedAt: '2026-11-03T02:30:00Z',
};

test('finalists stay hidden until voting has ended and the announcement time has passed', () => {
  assert.equal(finalistsState(schedule, Date.parse('2026-10-30T00:00:00Z')), 'waiting');
  assert.equal(finalistsState(schedule, Date.parse('2026-11-02T00:00:00Z')), 'waiting');
  assert.equal(finalistsState(schedule, Date.parse(schedule.resultsPublishedAt) - 1), 'waiting');
  assert.equal(finalistsState(schedule, Date.parse(schedule.resultsPublishedAt)), 'announced');
  // Voting forced open keeps finalists hidden even after the date.
  assert.equal(finalistsState({ ...schedule, votingOverride: 'open' }, Date.parse('2026-11-04T00:00:00Z')), 'waiting');
  assert.equal(finalistsState(null), 'unknown');
  assert.equal(finalistsState({ ...schedule, resultsPublishedAt: 'bad' }), 'unknown');
});

test('public finalists drop votes, ranks and tie flags and are sorted alphabetically', () => {
  const entry = (name, votes, tie = false) => ({ candidate: { _id: name, fullName: name, category: 'king', images: ['/uploads/a.jpg'], contactNumber: 'PRIVATE' }, votes, selectedByTieBreak: tie });
  const result = publicFinalists({ kings: [entry('Zaw', 90), entry('aung', 80), entry('Min', 10, true)], queens: [] });
  assert.deepEqual(result.king.map(p => p.fullName), ['aung', 'Min', 'Zaw']);
  const text = JSON.stringify(result);
  for (const hidden of ['votes', 'selectedByTieBreak', 'PRIVATE', 'rank']) assert.equal(text.includes(hidden), false);
  assert.deepEqual(result.queen, []);
  assert.throws(() => publicFinalists(null));
});

test('finalists API reads /results and returns the safe public shape', async () => {
  const seen = [];
  const api = createApi({ fetchImpl: async url => { seen.push(url); return new Response(JSON.stringify({ status: 'success', data: { results: {
    kings: [{ candidate: { _id: 'k1', fullName: 'Kyaw', images: [] }, votes: 3 }], queens: [],
  } } })); } });
  const result = await api.finalists();
  assert.equal(seen[0], '/api/v1/results');
  assert.equal(result.king[0].fullName, 'Kyaw');
  assert.equal('votes' in result.king[0], false);
});
