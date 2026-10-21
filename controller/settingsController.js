const Results = require("../model/resultsModel");
const Election = require("../model/electionModel");
const Ballot = require("../model/ballotsModel");
const User = require("../model/usersModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const {
  getElection,
  isCandidateManagementLocked,
  votingOverrides,
  withElectionOperation,
} = require("../utils/election");
const { dateFields, parseMyanmarTime, scheduleResponse } = require("../utils/schedule");

const editableFields = [...dateFields, "votingOverride"];

exports.getSettings = catchAsync(async (req, res) => {
  res.status(200).json({ status: "success", data: { schedule: scheduleResponse(await getElection()) } });
});

exports.updateSettings = catchAsync(async (req, res) => {
  const body = req.body || {};
  const fields = Object.keys(body);
  if (!fields.length || fields.some((field) => !editableFields.includes(field))) {
    throw new AppError(`Only these settings are editable: ${editableFields.join(", ")}.`, 400);
  }
  const updates = {};
  for (const field of fields) {
    if (field === "votingOverride") {
      if (!votingOverrides.includes(body.votingOverride)) {
        throw new AppError(`votingOverride must be one of: ${votingOverrides.join(", ")}.`, 400);
      }
      updates.votingOverride = body.votingOverride;
    } else {
      updates[field] = parseMyanmarTime(body[field], field);
    }
  }

  const updated = await withElectionOperation("settings", async ({ election, now, onRollback }) => {
    const resultsFinalized = await Results.exists({ _id: "election" });
    // Saved finalists must never become stale through a reopened voting period.
    if (
      resultsFinalized
      && (
        ["votingOpensAt", "votingClosesAt", "candidateManagementClosesAt"].some((field) => updates[field] && +updates[field] !== +election[field])
        || updates.votingOverride === "open"
      )
    ) {
      throw new AppError("The voting period cannot change after finalists have been finalized.", 409);
    }
    const before = Object.fromEntries([...editableFields, "candidateManagementLocked"].map((field) => [field, election[field]]));
    onRollback(() => Election.updateOne({ _id: "election" }, { $set: before }));

    const nextVotingOpensAt = updates.votingOpensAt || election.votingOpensAt;
    if (updates.candidateManagementClosesAt) {
      const diff = updates.candidateManagementClosesAt - nextVotingOpensAt;
      // When entered at minute precision equal to votingOpensAt, clamp the :59.999 tail to votingOpensAt.
      if (diff > 0 && diff < 60000) {
        updates.candidateManagementClosesAt = new Date(nextVotingOpensAt);
      }
    } else if (updates.votingOpensAt && election.candidateManagementClosesAt > updates.votingOpensAt) {
      updates.candidateManagementClosesAt = new Date(updates.votingOpensAt);
    }

    Object.assign(election, updates);
    election.candidateManagementLocked = isCandidateManagementLocked(election, now);
    await election.save();
    return election;
  });
  res.status(200).json({ status: "success", data: { schedule: scheduleResponse(updated) } });
});

exports.clearTestVotes = catchAsync(async (req, res) => {
  const clearedBallots = await withElectionOperation("settings", async ({ election, now, onRollback }) => {
    if (await Results.exists({ _id: "election" })) {
      throw new AppError("Cannot clear votes after finalist results have been finalized.", 409);
    }
    if (now >= election.votingOpensAt) {
      throw new AppError("Test votes can only be cleared before the scheduled voting start time.", 403);
    }
    const ballots = await Ballot.find({}).lean();
    const usersWithFlags = await User.find({
      $or: [{ hasVotedKing: true }, { hasVotedQueen: true }],
    }).select("_id hasVotedKing hasVotedQueen").lean();

    onRollback(async () => {
      if (ballots.length) {
        await Ballot.insertMany(ballots, { ordered: false }).catch(() => {});
      }
      for (const u of usersWithFlags) {
        await User.updateOne(
          { _id: u._id },
          { $set: { hasVotedKing: Boolean(u.hasVotedKing), hasVotedQueen: Boolean(u.hasVotedQueen) } },
        );
      }
    });

    const { deletedCount } = await Ballot.deleteMany({});
    await User.updateMany(
      { $or: [{ hasVotedKing: true }, { hasVotedQueen: true }] },
      { $set: { hasVotedKing: false, hasVotedQueen: false } },
    );
    return deletedCount;
  });

  res.status(200).json({
    status: "success",
    message: "All test votes have been cleared.",
    data: { clearedBallots },
  });
});
