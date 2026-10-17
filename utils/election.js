const mongoose = require("mongoose");
const Election = require("../model/electionModel");
const AppError = require("./appError");
const clock = require("./clock");

exports.getElection = async () => {
  // This latch is persisted, including when the first request follows downtime.
  await Election.updateOne({
    _id: "election",
    votingOpensAt: { $lte: clock.now() },
    candidateManagementLocked: false,
  }, { $set: { candidateManagementLocked: true } });
  const election = await Election.findById("election");
  if (!election) throw new AppError("Election settings have not been seeded.", 503);
  return election;
};

exports.checkPeriod = (election, action, now) => {
  if (action === "registration" && now > election.registrationClosesAt) {
    throw new AppError("Account registration has closed.", 403);
  }
  if (action === "candidate" && election.candidateManagementLocked) {
    throw new AppError("Candidate management is permanently locked because voting has started.", 403);
  }
  if (action === "voting" && (now < election.votingOpensAt || now > election.votingClosesAt)) {
    throw new AppError("This action is only available during the voting period.", 403);
  }
  if (action === "finalize" && now <= election.votingClosesAt) {
    throw new AppError("Voting has not closed.", 403);
  }
  if (action === "publish" && (now < election.resultsPublishedAt || now <= election.votingClosesAt)) {
    throw new AppError("Finalist results are not available yet.", 403);
  }
};

exports.withElectionTransaction = async (action, callback) => {
  await exports.getElection();
  return mongoose.connection.transaction(async (session) => {
    const election = await Election.findById("election").session(session);
    const now = clock.now();
    if (now >= election.votingOpensAt) election.candidateManagementLocked = true;
    exports.checkPeriod(election, action, now);
    election.operationVersion += 1;
    await election.save({ session });
    const result = await callback({ election, session, now });
    // Roll back slow requests that cross a deadline while doing database work.
    const finishedAt = clock.now();
    if (finishedAt >= election.votingOpensAt && !election.candidateManagementLocked) {
      election.candidateManagementLocked = true;
      await election.save({ session });
    }
    exports.checkPeriod(election, action, finishedAt);
    return result;
  });
};
