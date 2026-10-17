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

// One API process handles election operations in order. No database sessions,
// transactions, replica-set configuration, or persistent identity links are used.
let pendingOperation = Promise.resolve();

exports.withElectionOperation = (action, callback) => {
  const operation = pendingOperation.then(async () => {
    const election = await exports.getElection();
    const now = clock.now();
    if (now >= election.votingOpensAt) {
      election.candidateManagementLocked = true;
      await Election.updateOne({ _id: "election" }, { $set: { candidateManagementLocked: true } });
    }
    exports.checkPeriod(election, action, now);
    const undo = [];
    try {
      const result = await callback({ election, now, onRollback: (restore) => undo.push(restore) });
      const finishedAt = clock.now();
      if (finishedAt >= election.votingOpensAt) {
        election.candidateManagementLocked = true;
        await Election.updateOne({ _id: "election" }, { $set: { candidateManagementLocked: true } });
      }
      exports.checkPeriod(election, action, finishedAt);
      return result;
    } catch (error) {
      // Compensate completed writes on ordinary errors or crossed deadlines.
      // Unlike a database transaction, this cannot cover a process/power failure.
      let rollbackFailed = false;
      for (const restore of undo.reverse()) {
        try { await restore(); } catch { rollbackFailed = true; }
      }
      if (rollbackFailed) {
        console.error("Could not fully undo an incomplete election operation.");
        throw new AppError("Could not safely complete this action. Please retry.", 503);
      }
      throw error;
    }
  });
  // A failed request must not stop the queue from processing later requests.
  pendingOperation = operation.catch(() => {});
  return operation;
};
