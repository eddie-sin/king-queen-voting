const voteTotals = require('../utils/voteTotals');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { getControls } = require('../utils/eventControls');
exports.getResults = catchAsync(async (req, res) => {
  const before = await getControls();
  if (!before.announcementOpen || before.votingStatus !== 'closed') throw new AppError('Results announcement is not open.', 403);
  const awards = voteTotals.awards(await voteTotals.candidates(before));
  const after = await getControls();
  if (!after.announcementOpen || after.votingStatus !== 'closed' || after.round !== before.round || after.revision !== before.revision) throw new AppError('Announcement changed. Please refresh.', 403);
  res.json({status:'success',data:{results:{...awards,round:before.round,revision:before.revision}}});
});
