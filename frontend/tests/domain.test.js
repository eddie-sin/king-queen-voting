import test from 'node:test';
import assert from 'node:assert/strict';
import { publicCandidate, scheduleState, savedChoices, validKey, myanmarTime } from '../src/domain.js';

test('registration and voting have independent exact boundaries', () => {
  const schedule = { registrationClosesAt: '2026-10-20T10:00:00Z', votingOpensAt: '2026-10-20T12:00:00Z', votingClosesAt: '2026-10-20T14:00:00Z' };
  assert.deepEqual(scheduleState(schedule, Date.parse('2026-10-20T10:00:00Z')), { registration: 'open', voting: 'upcoming' });
  assert.equal(scheduleState(schedule, Date.parse(schedule.votingOpensAt)).voting, 'open');
  assert.equal(scheduleState(schedule, Date.parse(schedule.votingClosesAt)).voting, 'open');
  assert.equal(scheduleState(schedule, Date.parse(schedule.votingClosesAt) + 1).voting, 'closed');
  assert.equal(scheduleState(schedule, Date.parse(schedule.registrationClosesAt) + 1).registration, 'closed');
  assert.deepEqual(scheduleState(null), { registration: 'unknown', voting: 'unknown' });
  assert.equal(scheduleState({ ...schedule, votingClosesAt: 'invalid' }).voting, 'unknown');
  assert.equal(scheduleState({ ...schedule, votingClosesAt: schedule.votingOpensAt }).voting, 'unknown');
  assert.equal(scheduleState({ ...schedule, votingOverride: 'open' }, Date.parse('2026-10-20T10:00:00Z')).voting, 'open');
  assert.equal(scheduleState({ ...schedule, votingOverride: 'closed' }, Date.parse('2026-10-20T13:00:00Z')).voting, 'closed');
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
test('key format and Myanmar display', () => {
  assert.equal(validKey('a'.repeat(64)), true); assert.equal(validKey('A'.repeat(64)), false); assert.equal(validKey('a'.repeat(63)), false);
  assert.match(myanmarTime('2026-10-20T00:00:00Z'), /6:30 am MMT/);
});
