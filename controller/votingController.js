const mongoose = require("mongoose");
const VotingCredential = require("../model/voting_credentialsModel");
const Candidate = require("../model/candidatesModel");
const Ballot = require("../model/ballotsModel");
const User = require("../model/usersModel");
const Results = require("../model/resultsModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { hashVotingKey } = require("../utils/votingKey");
const { withElectionTransaction } = require("../utils/election");

const validateContest = (contest) => {
  if (!["king", "queen"].includes(contest)) throw new AppError("Contest must be king or queen.", 400);
};

const withCredential = (req, callback) => withElectionTransaction("voting", async ({ session }) => {
  const { votingKey } = req.body || {};
  if (typeof votingKey !== "string" || !/^[a-f0-9]{64}$/.test(votingKey)) {
    throw new AppError("A valid voting key is required.", 400);
  }
  if (await Results.exists({ _id: "election" }).session(session)) {
    throw new AppError("Voting has been finalized.", 403);
  }
  const user = await User.findOne({ _id: req.userId, status: "active" }).session(session);
  if (!user) throw new AppError("An active account is required.", 403);
  const credential = await VotingCredential.findOne({
    codeHash: hashVotingKey(req.userId, votingKey), status: "active", bindingVersion: 2,
  }).session(session);
  if (!credential) throw new AppError("Invalid or inactive voting key for this account.", 401);
  return callback({ session, credential });
});

const saveVote = (change) => catchAsync(async (req, res) => {
  const { candidateId, contest } = req.body || {};
  validateContest(contest);
  if (typeof candidateId !== "string" || !mongoose.isObjectIdOrHexString(candidateId)) {
    throw new AppError("A valid candidate ID is required.", 400);
  }
  await withCredential(req, async ({ session, credential }) => {
    const candidate = await Candidate.findOne({ _id: candidateId, category: contest, isActive: true }).session(session);
    if (!candidate) throw new AppError("Candidate does not exist, is inactive, or belongs to another contest.", 400);
    const filter = { credential: credential._id, contest };
    const existing = await Ballot.findOne(filter).session(session);
    if (change && !existing) throw new AppError("No vote exists for this contest. Submit a vote first.", 404);
    if (!change && existing) throw new AppError("You have already voted in this contest. Use change vote instead.", 409);
    if (change) await Ballot.updateOne(filter, { $set: { candidate: candidate._id } }, { session, runValidators: true });
    else await Ballot.create([{ ...filter, candidate: candidate._id }], { session });
    await User.updateOne({ _id: req.userId }, { $set: { [contest === "king" ? "hasVotedKing" : "hasVotedQueen"]: true } }, { session });
  });
  res.status(change ? 200 : 201).json({ status: "success", message: `${contest} vote ${change ? "changed" : "submitted"} successfully.` });
});

exports.submitVote = saveVote(false);
exports.changeVote = saveVote(true);

exports.viewVotes = catchAsync(async (req, res) => {
  const votes = await withCredential(req, ({ session, credential }) => Ballot.find({ credential: credential._id })
    .select("contest candidate -_id").populate("candidate").session(session));
  res.status(200).json({ status: "success", data: { votes } });
});

exports.removeVote = catchAsync(async (req, res) => {
  const { contest } = req.body || {};
  validateContest(contest);
  await withCredential(req, async ({ session, credential }) => {
    const removed = await Ballot.deleteOne({ credential: credential._id, contest }, { session });
    if (!removed.deletedCount) throw new AppError("No vote exists for this contest.", 404);
    await User.updateOne({ _id: req.userId }, { $set: { [contest === "king" ? "hasVotedKing" : "hasVotedQueen"]: false } }, { session });
  });
  res.status(200).json({ status: "success", message: `${contest} vote removed successfully.` });
});
