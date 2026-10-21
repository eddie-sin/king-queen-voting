const Election = require("../model/electionModel");
const AppError = require("./appError");
const clock = require("./clock");

const DEFAULT_CANDIDATE_CLOSES_AT = new Date("2026-10-27T23:59:59.999+06:30");

exports.votingOverrides = ["auto", "open", "closed"];

exports.isVotingOpen = (election, now = clock.now()) => {
  if (!election) return false;
  if (election.votingOverride === "open") return true;
  if (election.votingOverride === "closed") return false;
  return now >= election.votingOpensAt && now <= election.votingClosesAt;
};

exports.isCandidateManagementLocked = (election, now = clock.now()) => {
  if (!election) return false;
  const cutoff = election.candidateManagementClosesAt ?? election.votingOpensAt;
  return cutoff ? now > cutoff : Boolean(election.candidateManagementLocked);
};

exports.getElection = async () => {
  const election = await Election.findById("election");
  if (!election) throw new AppError("Election settings have not been seeded.", 503);
  let dirty = false;
  if (!election.candidateManagementClosesAt) {
    election.candidateManagementClosesAt = election.votingOpensAt < DEFAULT_CANDIDATE_CLOSES_AT
      ? election.votingOpensAt
      : DEFAULT_CANDIDATE_CLOSES_AT;
    dirty = true;
  }
  if (!election.votingOverride) {
    election.votingOverride = "auto";
    dirty = true;
  }
  const locked = exports.isCandidateManagementLocked(election, clock.now());
  if (election.candidateManagementLocked !== locked) {
    election.candidateManagementLocked = locked;
    dirty = true;
  }
  if (dirty) {
    await Election.updateOne({ _id: "election" }, {
      $set: {
        candidateManagementClosesAt: election.candidateManagementClosesAt,
        votingOverride: election.votingOverride,
        candidateManagementLocked: election.candidateManagementLocked,
      },
    });
  }
  return election;
};

exports.checkPeriod = (election, action, now) => {
  if (action === "registration" && now > election.registrationClosesAt) {
    throw new AppError("Account registration has closed.", 403);
  }
  if (action === "candidate" && exports.isCandidateManagementLocked(election, now)) {
    throw new AppError("Candidate management has closed.", 403);
  }
  if (action === "voting" && !exports.isVotingOpen(election, now)) {
    throw new AppError("This action is only available during the voting period.", 403);
  }
  if (action === "finalize" && (now <= election.votingClosesAt || exports.isVotingOpen(election, now))) {
    throw new AppError("Voting has not closed.", 403);
  }
  if (action === "publish" && (now < election.resultsPublishedAt || now <= election.votingClosesAt || exports.isVotingOpen(election, now))) {
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
    const lockedBefore = exports.isCandidateManagementLocked(election, now);
    if (election.candidateManagementLocked !== lockedBefore) {
      election.candidateManagementLocked = lockedBefore;
      await Election.updateOne({ _id: "election" }, { $set: { candidateManagementLocked: lockedBefore } });
    }
    exports.checkPeriod(election, action, now);
    const undo = [];
    try {
      const result = await callback({ election, now, onRollback: (restore) => undo.push(restore) });
      const finishedAt = clock.now();
      const lockedAfter = exports.isCandidateManagementLocked(election, finishedAt);
      if (election.candidateManagementLocked !== lockedAfter) {
        election.candidateManagementLocked = lockedAfter;
        await Election.updateOne({ _id: "election" }, { $set: { candidateManagementLocked: lockedAfter } });
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
