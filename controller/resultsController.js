const Candidate = require('../model/candidatesModel');
const Ballot = require('../model/ballotsModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { getControls } = require('../utils/eventControls');
exports.getResults = catchAsync(async (req, res) => {
  const before = await getControls();
  if (!before.announcementOpen || before.votingStatus !== 'closed') throw new AppError('Results announcement is not open.', 403);
  const [candidates, totals] = await Promise.all([
    Candidate.find().lean(),
    Ballot.aggregate([{ $match: { round: before.round } }, { $group: { _id: '$candidate', votes: { $sum: 1 } } }]),
  ]);
  const after = await getControls();
  if (!after.announcementOpen || after.votingStatus !== 'closed' || after.round !== before.round || after.revision !== before.revision) throw new AppError('Announcement changed. Please refresh.', 403);
  const counts = new Map(totals.map(entry => [String(entry._id), entry.votes]));
  const list = category => candidates.filter(c => c.category === category).map(candidate => ({ candidate, votes: counts.get(String(candidate._id)) || 0 }))
    .sort((a, b) => b.votes - a.votes || a.candidate.fullName.localeCompare(b.candidate.fullName) || String(a.candidate._id).localeCompare(String(b.candidate._id)));
  res.json({ status: 'success', data: { results: { kings: list('king'), queens: list('queen'), round: before.round, revision: before.revision } } });
});
