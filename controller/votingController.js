const mongoose = require("mongoose");
const VotingCredential = require("../model/voting_credentialsModel");
const Candidate = require("../model/candidatesModel");
const Ballot = require("../model/ballotsModel");
const User = require("../model/usersModel");
const Results = require("../model/resultsModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { hashVotingKey } = require("../utils/votingKey");
const { withElectionOperation } = require("../utils/election");

const validateContest = (contest) => {
  if (!["king", "queen"].includes(contest)) throw new AppError("Contest must be king or queen.", 400);
};

const withCredential = (req, callback) => withElectionOperation("voting", async ({ onRollback }) => {
  const { votingKey } = req.body || {};
  if (typeof votingKey !== "string" || !/^[a-f0-9]{64}$/.test(votingKey)) {
    throw new AppError("A valid voting key is required.", 400);
  }
  if (await Results.exists({ _id: "election" })) {
    throw new AppError("Voting has been finalized.", 403);
  }
  const user = await User.findOne({ _id: req.userId, status: "active" });
  if (!user) throw new AppError("An active account is required.", 403);
  const credential = await VotingCredential.findOne({
    codeHash: hashVotingKey(req.userId, votingKey), status: "active", bindingVersion: 2,
  });
  if (!credential) throw new AppError("Invalid or inactive voting key for this account.", 401);
  // A key also lets us repair participation flags after an interrupted process.
  const ballots = await Ballot.find({ credential: credential._id }).select("contest");
  const flags = {
    hasVotedKing: ballots.some((ballot) => ballot.contest === "king"),
    hasVotedQueen: ballots.some((ballot) => ballot.contest === "queen"),
  };
  if (user.hasVotedKing !== flags.hasVotedKing || user.hasVotedQueen !== flags.hasVotedQueen) {
    await User.updateOne({ _id: req.userId }, { $set: flags });
    Object.assign(user, flags);
  }
  return callback({ credential, user, onRollback });
});

const saveVote = (change) => catchAsync(async (req, res) => {
  const { candidateId, contest } = req.body || {};
  validateContest(contest);
  if (typeof candidateId !== "string" || !mongoose.isObjectIdOrHexString(candidateId)) {
    throw new AppError("A valid candidate ID is required.", 400);
  }
  await withCredential(req, async ({ credential, user, onRollback }) => {
    const candidate = await Candidate.findOne({ _id: candidateId, category: contest, isActive: true });
    if (!candidate) throw new AppError("Candidate does not exist, is inactive, or belongs to another contest.", 400);
    const filter = { credential: credential._id, contest };
    const existing = await Ballot.findOne(filter);
    if (change && !existing) throw new AppError("No vote exists for this contest. Submit a vote first.", 404);
    if (!change && existing) throw new AppError("You have already voted in this contest. Use change vote instead.", 409);
    const ballot = existing || new Ballot({ ...filter, candidate: candidate._id });
    const before = existing?.toObject();
    onRollback(() => before
      ? Ballot.replaceOne({ _id: ballot._id }, before, { upsert: true })
      : Ballot.deleteOne({ _id: ballot._id }));
    ballot.candidate = candidate._id;
    await ballot.save();
    const flag = contest === "king" ? "hasVotedKing" : "hasVotedQueen";
    onRollback(() => User.updateOne({ _id: req.userId }, { $set: { [flag]: Boolean(user[flag]) } }));
    await User.updateOne({ _id: req.userId }, { $set: { [flag]: true } });
  });
  res.status(change ? 200 : 201).json({ status: "success", message: `${contest} vote ${change ? "changed" : "submitted"} successfully.` });
});

exports.submitVote = saveVote(false);
exports.changeVote = saveVote(true);

exports.viewVotes = catchAsync(async (req, res) => {
  const votes = await withCredential(req, ({ credential }) => Ballot.find({ credential: credential._id })
    .select("contest candidate -_id").populate("candidate"));
  res.status(200).json({ status: "success", data: { votes } });
});

exports.removeVote = catchAsync(async (req, res) => {
  const { contest } = req.body || {};
  validateContest(contest);
  await withCredential(req, async ({ credential, user, onRollback }) => {
    const ballot = await Ballot.findOne({ credential: credential._id, contest });
    if (!ballot) throw new AppError("No vote exists for this contest.", 404);
    const before = ballot.toObject();
    onRollback(() => Ballot.replaceOne({ _id: ballot._id }, before, { upsert: true }));
    await Ballot.deleteOne({ _id: ballot._id });
    const flag = contest === "king" ? "hasVotedKing" : "hasVotedQueen";
    onRollback(() => User.updateOne({ _id: req.userId }, { $set: { [flag]: Boolean(user[flag]) } }));
    await User.updateOne({ _id: req.userId }, { $set: { [flag]: false } });
  });
  res.status(200).json({ status: "success", message: `${contest} vote removed successfully.` });
});
