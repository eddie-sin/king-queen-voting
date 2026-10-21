const Candidate = require("../model/candidatesModel");
const Ballot = require("../model/ballotsModel");
const Results = require("../model/resultsModel");
const { getElection, isVotingOpen, withElectionOperation } = require("./election");
const { selectFinalists } = require("./finalists");
const clock = require("./clock");

exports.getOrCreateResults = async ({ now }) => {
  const existing = await Results.findById("election");
  if (existing) return existing;
  const candidates = await Candidate.find({ isActive: true }).select("_id category");
  const counts = await Ballot.aggregate([
    { $group: { _id: { candidate: "$candidate", contest: "$contest" }, votes: { $sum: 1 } } },
  ]);
  const totals = new Map(counts.map((entry) => [`${entry._id.contest}:${entry._id.candidate}`, entry.votes]));
  const ranked = (contest) => candidates.filter((candidate) => candidate.category === contest).map((candidate) => ({
    candidate: candidate._id,
    votes: totals.get(`${contest}:${candidate._id}`) || 0,
  }));
  // Atomic insert-if-absent: concurrent callers can never replace a saved draw.
  try {
    return await Results.findOneAndUpdate({ _id: "election" }, { $setOnInsert: {
      kings: selectFinalists(ranked("king")), queens: selectFinalists(ranked("queen")), finalizedAt: now,
    } }, { upsert: true, returnDocument: "after", runValidators: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return Results.findById("election");
  }
};

exports.finalizeResultsIfDue = async () => {
  const election = await getElection();
  const now = clock.now();
  if (now <= election.votingClosesAt || isVotingOpen(election, now) || await Results.exists({ _id: "election" })) return;
  try {
    await withElectionOperation("finalize", exports.getOrCreateResults);
  } catch (error) {
    // An admin may have extended the period between the initial read and queued operation.
    if (error.statusCode !== 403) throw error;
  }
};
