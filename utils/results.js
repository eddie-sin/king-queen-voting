const Candidate = require("../model/candidatesModel");
const Ballot = require("../model/ballotsModel");
const Results = require("../model/resultsModel");
const { getElection, withElectionTransaction } = require("./election");
const { selectFinalists } = require("./finalists");
const clock = require("./clock");

exports.getOrCreateResults = async ({ session, now }) => {
  const existing = await Results.findById("election").session(session);
  if (existing) return existing;
  const candidates = await Candidate.find({ isActive: true }).select("_id category").session(session);
  const counts = await Ballot.aggregate([
    { $group: { _id: { candidate: "$candidate", contest: "$contest" }, votes: { $sum: 1 } } },
  ]).session(session);
  const totals = new Map(counts.map((entry) => [`${entry._id.contest}:${entry._id.candidate}`, entry.votes]));
  const ranked = (contest) => candidates.filter((candidate) => candidate.category === contest).map((candidate) => ({
    candidate: candidate._id,
    votes: totals.get(`${contest}:${candidate._id}`) || 0,
  }));
  const [results] = await Results.create([{
    _id: "election", kings: selectFinalists(ranked("king")), queens: selectFinalists(ranked("queen")), finalizedAt: now,
  }], { session });
  return results;
};

exports.finalizeResultsIfDue = async () => {
  const election = await getElection();
  if (clock.now() <= election.votingClosesAt || await Results.exists({ _id: "election" })) return;
  try {
    await withElectionTransaction("finalize", exports.getOrCreateResults);
  } catch (error) {
    // An admin may have extended the period between the initial read and transaction.
    if (error.statusCode !== 403) throw error;
  }
};
