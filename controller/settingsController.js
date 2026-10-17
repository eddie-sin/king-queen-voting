const Results = require("../model/resultsModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { getElection, withElectionTransaction } = require("../utils/election");
const { dateFields, parseMyanmarTime, scheduleResponse } = require("../utils/schedule");

exports.getSettings = catchAsync(async (req, res) => {
  res.status(200).json({ status: "success", data: { schedule: scheduleResponse(await getElection()) } });
});

exports.updateSettings = catchAsync(async (req, res) => {
  const body = req.body || {};
  const fields = Object.keys(body);
  if (!fields.length || fields.some((field) => !dateFields.includes(field))) {
    throw new AppError(`Only these date/time values are editable: ${dateFields.join(", ")}.`, 400);
  }
  const updates = Object.fromEntries(fields.map((field) => [field, parseMyanmarTime(body[field], field)]));
  const updated = await withElectionTransaction("settings", async ({ election, session, now }) => {
    const resultsFinalized = await Results.exists({ _id: "election" }).session(session);
    // Saved finalists must never become stale through a reopened voting period.
    if (resultsFinalized && ["votingOpensAt", "votingClosesAt"].some((field) => updates[field] && +updates[field] !== +election[field])) {
      throw new AppError("The voting period cannot change after finalists have been finalized.", 409);
    }
    Object.assign(election, updates);
    if (now >= election.votingOpensAt) election.candidateManagementLocked = true;
    await election.save({ session });
    return election;
  });
  res.status(200).json({ status: "success", data: { schedule: scheduleResponse(updated) } });
});
