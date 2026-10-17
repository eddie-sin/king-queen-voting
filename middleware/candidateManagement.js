const catchAsync = require("../utils/catchAsync");
const { getElection, checkPeriod } = require("../utils/election");
const clock = require("../utils/clock");

// Reject before buffering or uploading images; the write transaction rechecks.
module.exports = catchAsync(async (req, res, next) => {
  checkPeriod(await getElection(), "candidate", clock.now());
  next();
});
