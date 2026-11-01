import test from 'node:test';
import assert from 'node:assert/strict';
import { canAnnounceLantern, canLanternReset } from '../src/specialControls.js';

test('Lantern reset visibility follows full-admin or explicit permission', () => {
  assert.equal(canLanternReset({ role: 'admin', permissions: [] }), true);
  assert.equal(canLanternReset({ role: 'lantern_admin', permissions: ['lantern.votes.reset'] }), true);
  assert.equal(canLanternReset({ role: 'lantern_admin', permissions: [] }), false);
});

test('winner announcement requires a closed, unannounced state and backend winner', () => {
  const winner = { lantern: { title: 'Golden Light' }, votes: 4 };
  assert.equal(canAnnounceLantern({ controls: { lanternVotingOpen: false, lanternAnnouncementOpen: false }, winner }), true);
  assert.equal(canAnnounceLantern({ controls: { lanternVotingOpen: true, lanternAnnouncementOpen: false }, winner }), false);
  assert.equal(canAnnounceLantern({ controls: { lanternVotingOpen: false, lanternAnnouncementOpen: true }, winner }), false);
  assert.equal(canAnnounceLantern({ controls: { lanternVotingOpen: false, lanternAnnouncementOpen: false }, winner: null }), false);
});
