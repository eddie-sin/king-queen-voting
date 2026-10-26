import test from 'node:test';
import assert from 'node:assert/strict';
import { announcementState, eventState, publicCandidate, publicResults, savedChoices } from '../src/domain.js';

test('registration, voting and announcement follow explicit server controls', () => {
  assert.deepEqual(eventState({ registrationOpen: true, votingStatus: 'open' }), { registration: 'open', voting: 'open' });
  assert.deepEqual(eventState({ registrationOpen: false, votingStatus: 'closing' }), { registration: 'closed', voting: 'closing' });
  assert.deepEqual(eventState({ registrationOpen: false, votingStatus: 'closed' }), { registration: 'closed', voting: 'closed' });
  assert.deepEqual(eventState(null), { registration: 'unknown', voting: 'unknown' });
  assert.deepEqual(eventState({ registrationOpen: 'yes', votingStatus: 'scheduled' }), { registration: 'unknown', voting: 'unknown' });
  assert.equal(announcementState({ announcementOpen: true, votingStatus: 'closed' }), 'announced');
  assert.equal(announcementState({ announcementOpen: true, votingStatus: 'open' }), 'waiting');
  assert.equal(announcementState({ announcementOpen: false, votingStatus: 'closed' }), 'waiting');
  assert.equal(announcementState({}), 'unknown');
});
test('public candidate projection strips contacts and unsafe URLs', () => {
  const candidate = publicCandidate({ _id: '1', fullName: 'Name', phone: 'PRIVATE', contactNumber: 'PRIVATE', email: 'PRIVATE', images: ['/uploads/a.jpg', 'https://example.test/a.jpg', '//unsafe.example/a', 'javascript:alert(1)', '/uploads/b.jpg', '/uploads/c.jpg'], category: 'king', isActive: true });
  assert.equal(candidate.images.length, 3);
  assert.equal(JSON.stringify(candidate).includes('PRIVATE'), false);
  assert.equal(candidate.bio, ''); assert.equal(candidate.age, null);
});
test('choices are independent and unavailable candidates still count as votes', () => {
  const choices = savedChoices([{ contest: 'queen', candidate: { _id: 'q', fullName: 'Queen' } }]);
  assert.equal(choices.king, null); assert.equal(choices.queen._id, 'q');
  assert.ok(savedChoices([{ contest: 'king', candidate: null }]).king);
  assert.throws(() => savedChoices(null));
  assert.throws(() => savedChoices([{ contest: 'king', candidate: null }, { contest: 'king', candidate: null }]));
});
test('announced result projection validates revisions, totals and deterministic ranking', () => {
  const candidate = (id, name, category) => ({ _id: id, fullName: name, category, images: ['/uploads/a.jpg'], isActive: true, contactNumber: 'PRIVATE' });
  const result = publicResults({ round: 3, revision: 8,
    kings: [
      { candidate: candidate('k2', 'Zaw', 'king'), votes: 2, title: '1st Runner-up' },
      { candidate: candidate('k1', 'Aung', 'king'), votes: 5, title: 'King' },
    ], queens: [] });
  assert.deepEqual(result.king.map(entry => [entry._id, entry.votes, entry.title]), [['k1', 5, 'King'], ['k2', 2, '1st Runner-up']]);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.throws(() => publicResults(null));
  assert.throws(() => publicResults({ round: 1, revision: 1, kings: [{ candidate: candidate('k', 'K', 'king'), votes: -1 }], queens: [] }));
});
