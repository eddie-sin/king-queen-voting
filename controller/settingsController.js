const Results = require("../model/resultsModel");
const Election = require("../model/electionModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { getElection, withElectionOperation } = require("../utils/election");
const { dateFields, parseMyanmarTime, scheduleResponse } = require("../utils/schedule");
const editableFields = [...dateFields, "memoryPhotosEnabled"];

exports.getSettings = catchAsync(async (req, res) => {
  res.status(200).json({ status: "success", data: { schedule: scheduleResponse(await getElection()) } });
});

exports.updateSettings = catchAsync(async (req, res) => {
  const body = req.body || {};
  const fields = Object.keys(body);
  if (!fields.length || fields.some((field) => !editableFields.includes(field))) {
    throw new AppError(`Only these settings are editable: ${editableFields.join(", ")}.`, 400);
  }
  const updates = Object.fromEntries(fields.map((field) => {
    if (field === "memoryPhotosEnabled") {
      if (typeof body[field] !== "boolean") {
        throw new AppError("memoryPhotosEnabled must be a Boolean.", 400);
      }
      return [field, body[field]];
    }
    return [field, parseMyanmarTime(body[field], field)];
  }));
  const updated = await withElectionOperation("settings", async ({ election, now, onRollback }) => {
    const resultsFinalized = await Results.exists({ _id: "election" });
    // Saved finalists must never become stale through a reopened voting period.
    if (resultsFinalized && ["votingOpensAt", "votingClosesAt"].some((field) => updates[field] && +updates[field] !== +election[field])) {
      throw new AppError("The voting period cannot change after finalists have been finalized.", 409);
    }
    const before = Object.fromEntries(editableFields.map((field) => [field,
      field === "memoryPhotosEnabled" ? election[field] === true : election[field],
    ]));
    onRollback(() => Election.updateOne({ _id: "election" }, { $set: before }));
    Object.assign(election, updates);
    if (now >= election.votingOpensAt) election.candidateManagementLocked = true;
    await election.save();
    return election;
  });
  res.status(200).json({ status: "success", data: { schedule: scheduleResponse(updated) } });
});
