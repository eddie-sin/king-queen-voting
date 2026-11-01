const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planAwards } = require('../utils/awardSelection.mjs');
const { selectAwards, awards } = require('../utils/voteTotals');
const rows = [ ['king', 9], ['king', 4], ['king', 4], ['queen', 8], ['queen', 3], ['queen', 0] ].map(([category, votes], i) => ({ candidate: { _id: String(i + 1).padStart(24, '0'), category, fullName: `Candidate ${i + 1}`, isActive: true }, votes }));

test('default awards require a decision for the second-place tie and preserve real totals', () => {
  const plan = planAwards(rows);
  assert.equal(plan.ready, false); assert.equal(plan.selection.king, rows[0].candidate._id);
  assert.equal(plan.slots.find(s => s.key === 'mrs').tied, true);
  const selection = selectAwards(rows, { mode: 'default', picks: { mrs: rows[2].candidate._id } });
  assert.deepEqual(awards(rows, selection).kings.map(r => [r.candidate._id, r.votes, r.title]), [[rows[0].candidate._id, 9, 'King'], [rows[2].candidate._id, 4, 'Mrs Thadingyut']]);
  assert.throws(() => selectAwards(rows, { mode: 'default', picks: { king: rows[1].candidate._id, mrs: rows[0].candidate._id } }), { statusCode: 409 });
});
test('manual awards allow lower and zero vote choices but reject duplicate or cross-category choices', () => {
  const picks = { king: rows[2].candidate._id, mrs: rows[0].candidate._id, queen: rows[5].candidate._id, miss: rows[3].candidate._id };
  const selected = selectAwards(rows, { mode: 'manual', picks });
  assert.deepEqual(awards(rows, selected).queens.map(r => [r.votes, r.title]), [[0, 'Queen'], [8, 'Miss Thadingyut']]);
  for (const bad of [{ ...picks, mrs: picks.king }, { ...picks, king: picks.queen }, { ...picks, king: 'ffffffffffffffffffffffff' }, { ...picks, miss: undefined }]) assert.throws(() => selectAwards(rows, { mode: 'manual', picks: bad }), { statusCode: 409 });
});
test('all-zero defaults require explicit tie choices and sparse categories can be announced', () => {
  const zeros = rows.slice(0, 3).map(r => ({ ...r, votes: 0 }));
  assert.equal(planAwards(zeros).ready, false);
  assert.equal(planAwards(zeros, 'default', { king: zeros[1].candidate._id, mrs: zeros[2].candidate._id }).ready, true);
  assert.equal(awards([rows[0]]).kings.length, 1); assert.equal(awards([]).queens.length, 0);
});
