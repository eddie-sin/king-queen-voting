const catchAsync = require('../utils/catchAsync');
const { getControls, requireCandidateChanges } = require('../utils/eventControls');
module.exports = catchAsync(async (req, res, next) => {
  requireCandidateChanges(await getControls());
  next();
});
