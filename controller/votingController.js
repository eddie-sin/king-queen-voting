const mongoose = require('mongoose');
const Candidate = require('../model/candidatesModel');
const Ballot = require('../model/ballotsModel');
const User = require('../model/usersModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { getControls, withControls } = require('../utils/eventControls');
const admission = require('../utils/voteAdmission');
exports.submitVote = catchAsync(async (req, res) => {
  const body = req.body || {};
  if (Object.keys(body).some(k => !['candidateId', 'contest', 'round', 'window'].includes(k))) throw new AppError('Unexpected vote fields.', 400);
  const { candidateId, contest, round, window } = body;
  if (!['king', 'queen'].includes(contest) || typeof candidateId !== 'string' || !mongoose.isObjectIdOrHexString(candidateId)
    || !Number.isSafeInteger(round) || !Number.isSafeInteger(window) || round < 1 || window < 1) throw new AppError('Refresh voting status and select a valid candidate.', 400);
  const signal = new AbortController();
  const disconnected = () => { if (!res.writableFinished) signal.abort(); };
  res.once('close', disconnected);
  let saved;
  try {
    saved = await admission.admit(() => withControls(async ({ session, controls }) => {
      const user = await User.findOne({ _id: req.userId, status: 'active', tokenVersion: req.user.tokenVersion }).session(session);
      if (!user) throw new AppError('Your account is no longer permitted to vote.', 403);
      if (controls.round !== round || controls.window !== window) throw new AppError('Voting has changed. Refresh before submitting again.', 409);
      const existing = await Ballot.findOne({ user: user._id, round, contest }).session(session);
      if (existing) {
        if (String(existing.candidate) !== candidateId) throw new AppError('You have already voted in this category. Votes cannot be changed.', 409);
        return { alreadyRecorded: true };
      }
      if (!['open', 'closing'].includes(controls.votingStatus) || controls.announcementOpen) throw new AppError('Voting is closed.', 409);
      const candidate = await Candidate.findOne({ _id: candidateId, category: contest, isActive: true }).session(session);
      if (!candidate) throw new AppError('This candidate is not available in that category.', 400);
      await Ballot.create([{ user: user._id, candidate: candidate._id, contest, round }], { session });
      return { alreadyRecorded: false };
    }), signal.signal);
  } finally { res.off('close', disconnected); }
  res.status(saved.alreadyRecorded ? 200 : 201).json({ status: 'success', message: 'Your vote is recorded.', data: saved });
});
exports.viewVotes = catchAsync(async (req, res) => {
  const controls = await getControls();
  const votes = await Ballot.find({ user: req.userId, round: controls.round }).select('contest candidate -_id').populate('candidate');
  res.json({ status: 'success', data: { votes, round: controls.round, window: controls.window } });
});
