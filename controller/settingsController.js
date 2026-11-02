const Action = require('../model/adminActionsModel');
const Ballot = require('../model/ballotsModel');
const LanternVote = require('../model/lanternVotesModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { getControls, publicControls, staffMutation, withControls, audit, authorizeStaff } = require('../utils/eventControls');
const admission = require('../utils/voteAdmission');
const { can } = require('../utils/permissions');
const totals = require('../utils/voteTotals');
const normalizeSelection = value => {
  if (value === undefined) return { mode: 'default', picks: {} };
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(k => !['mode', 'picks'].includes(k))
    || !['default', 'manual'].includes(value.mode) || !value.picks || Array.isArray(value.picks) || typeof value.picks !== 'object'
    || Object.entries(value.picks).some(([key, id]) => !['king', 'queen', 'mrs', 'miss'].includes(key) || typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id))) {
    throw new AppError('Choose a valid announcement mode and title holders.', 400);
  }
  return { mode: value.mode, picks: Object.fromEntries(Object.entries(value.picks).sort(([a], [b]) => a.localeCompare(b))) };
};
// This scoped preview is available to announcers only while results are hidden
// and voting is fully closed. It does not grant the general private-totals API.
exports.announcementPreview = catchAsync(async (req, res) => {
  const data = await require('../utils/transactions').transaction(async session => {
    await authorizeStaff(req.admin, 'announcement.open', session);
    const controls = await getControls(session);
    if (controls.votingStatus !== 'closed' || controls.announcementOpen) throw new AppError('Close voting and hide the announcement before choosing title holders.', 409);
    const entries = (await totals.candidates(controls, session)).map(row => ({ votes: row.votes, candidate: {
      _id: row.candidate._id, fullName: row.candidate.fullName, category: row.candidate.category,
      images: row.candidate.images, batchNumber: row.candidate.batchNumber, isActive: row.candidate.isActive,
    } }));
    return { entries, round: controls.round, revision: controls.revision };
  });
  res.json({ status: 'success', data });
});
const sameSelection = (receipt, selection) => JSON.stringify(normalizeSelection(receipt.details?.selectionRequest)) === JSON.stringify(selection);
const ACTIONS = ['participation.require', 'participation.bypass', 'registration.open', 'registration.close', 'voting.open', 'voting.close', 'announcement.open', 'announcement.close', 'votes.clear', 'memory.open', 'memory.close', 'lantern.open', 'lantern.close', 'lantern.announce', 'lantern.hide', 'lantern.votes.reset', 'wishes.open', 'wishes.close'];
let commandBusy = false;
const settingsResponse = async (req, controls, result) => {
  const data = { controls };
  // Re-read live permissions, including after a command or receipt replay.
  // A cleared-ballot count is also a private total; do not expose an alias.
  if (req.admin && can(await authorizeStaff(req.admin), 'votes.read')) {
    data.ballotCount = await Ballot.countDocuments({});
    if (result && Object.hasOwn(result, 'clearedBallots')) data.clearedBallots = result.clearedBallots;
  }
  if (result && Object.hasOwn(result, 'lanternVotesRemoved')) {
    data.lanternVotesRemoved = result.lanternVotesRemoved;
    data.lanternVoteTotals = result.lanternVoteTotals || [];
  }
  return data;
};
exports.getSettings = catchAsync(async (req, res) => {
  const controls = await getControls();
  const data = await settingsResponse(req, publicControls(controls));
  res.json({ status: 'success', data });
});
exports.command = catchAsync(async (req, res) => {
  const action = req.params.action;
  const { revision, operationId, confirmation } = req.body || {};
  if (!ACTIONS.includes(action) || Object.keys(req.body || {}).some(k => !['revision', 'operationId', 'confirmation', ...(action === 'announcement.open' ? ['awardSelection'] : [])].includes(k))
    || !Number.isSafeInteger(revision) || revision < 0 || typeof operationId !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(operationId)) throw new AppError('Refresh controls before performing this action.', 400);
  if (action === 'votes.clear' && confirmation !== 'CLEAR ALL VOTES') throw new AppError('Confirm by entering CLEAR ALL VOTES.', 400);
  const selectionRequest = action === 'announcement.open' ? normalizeSelection(req.body.awardSelection) : undefined;
  const permission = (action.startsWith('wishes.') || action.startsWith('participation.')) ? 'admin' : action;
  await authorizeStaff(req.admin, permission);
  if (commandBusy) throw new AppError('Another control is being updated. Refresh and retry shortly.', 409);
  commandBusy = true;
  try {
    // Validate before stopping admissions. The transaction rechecks all authority/state.
    const before = await getControls();
    const previous = await Action.findOne({ operationId }).lean();
    if (!previous && before.revision !== revision) throw new AppError('Controls changed in another session. Refresh and try again.', 409);
    if (previous && action === 'announcement.open' && !sameSelection(previous, selectionRequest)) throw new AppError('This operation ID was already used for a different announcement.', 409);
    if (previous && !(action === 'voting.close' && before.votingStatus === 'closing' && previous.details?.window === before.window)) {
      if (String(previous.actor) !== String(req.admin._id) || previous.action !== action) throw new AppError('This operation ID was already used.', 409);
      const current = await staffMutation(req, permission, async ({ controls }) => publicControls(controls));
      if (action === 'voting.open' && current.votingStatus === 'open' && current.window === previous.details?.window) admission.open(current);
      const replay = { clearedBallots: previous.details?.clearedBallots || 0 };
      if (action === 'lantern.votes.reset') {
        replay.lanternVotesRemoved = replay.clearedBallots;
        replay.lanternVoteTotals = await totals.lanterns();
      }
      return res.json({ status: 'success', data: await settingsResponse(req, current, replay) });
    }
    if (action === 'voting.close') admission.close(before);
    const result = await staffMutation(req, permission, async ({ controls, session, actor }) => {
      const existing = await Action.findOne({ operationId }).session(session);
      if (existing) {
        if (String(existing.actor) !== String(actor._id) || existing.action !== action) throw new AppError('This operation ID was already used.', 409);
        if (action === 'announcement.open' && !sameSelection(existing, selectionRequest)) throw new AppError('This operation ID was already used for a different announcement.', 409);
        return { clearedBallots: existing.details?.clearedBallots || 0 };
      }
      if (controls.revision !== revision) throw new AppError('Controls changed. Refresh and try again.', 409);
      let clearedBallots = 0;
      switch (action) {
        case 'participation.require': controls.participationRequired = true; break;
        case 'participation.bypass': controls.participationRequired = false; break;
        case 'wishes.open': controls.wishPostingOpen=true; break;
        case 'wishes.close': controls.wishPostingOpen=false; break;
        case 'registration.open': controls.registrationOpen = true; break;
        case 'registration.close': controls.registrationOpen = false; break;
        case 'voting.open':
          if (controls.votingStatus !== 'closed' || controls.announcementOpen) throw new AppError('Finish closing voting and hide announcement before opening voting.', 409);
          controls.votingStatus = 'open'; controls.window++; break;
        case 'voting.close':
          if (controls.votingStatus === 'open') controls.votingStatus = 'closing';
          break;
        case 'announcement.open':
          if (controls.votingStatus !== 'closed' || controls.announcementOpen) throw new AppError('Close voting and hide the announcement before choosing title holders.', 409);
          controls.announcedAwards = { ...totals.selectAwards(await totals.candidates(controls, session), selectionRequest), round: controls.round, selectedBy: actor._id, selectedAt: new Date() };
          controls.announcementOpen = true; break;
        case 'announcement.close': controls.announcementOpen = false; controls.announcedAwards = undefined; break;
        case 'votes.clear':
          if (controls.votingStatus !== 'closed' || controls.announcementOpen) throw new AppError('Close voting and hide announcement before clearing votes.', 409);
          clearedBallots = (await Ballot.deleteMany({}).session(session)).deletedCount;
          controls.round++; controls.announcedAwards = undefined; break;
        case 'lantern.open':
          if(controls.lanternAnnouncementOpen) throw new AppError('Hide lantern announcement before reopening voting.',409);
          if(!controls.lanternVotingOpen) controls.lanternWindow=(controls.lanternWindow||0)+1;
          controls.lanternVotingOpen=true; break;
        case 'lantern.close': controls.lanternVotingOpen=false; break;
        case 'lantern.announce':
          if(controls.lanternVotingOpen) throw new AppError('Close lantern voting before announcing.',409);
          await require('./lanternVotingController').winner(session);
          controls.lanternAnnouncementOpen=true; break;
        case 'lantern.hide': controls.lanternAnnouncementOpen=false; break;
        case 'lantern.votes.reset':
          if (controls.lanternVotingOpen || controls.lanternAnnouncementOpen) throw new AppError('Close Lantern voting and hide the winner announcement before resetting votes.',409);
          clearedBallots = (await LanternVote.deleteMany({}).session(session)).deletedCount;
          break;
        case 'memory.open': controls.memoryPhotosEnabled = true; break;
        case 'memory.close': controls.memoryPhotosEnabled = false; break;
      }
      require('../utils/publicCalculations').clear();
      controls.revision++;
      await audit(session, actor, action, { round: controls.round, window: controls.window, clearedBallots, ...(selectionRequest ? { selectionRequest, awards: controls.announcedAwards.toObject() } : {}) }, operationId);
      return { clearedBallots };
    });
    if (action === 'voting.close') {
      await admission.drain();
      // Once closure begins it must finish even if the operator's permission is
      // revoked during draining. Every completion still shares the database fence.
      await withControls(async ({ controls }) => {
        if (controls.votingStatus === 'closing') { controls.votingStatus = 'closed'; controls.revision++; }
      });
    }
    const current = await getControls();
    if (action === 'lantern.votes.reset') {
      result.lanternVotesRemoved = result.clearedBallots || 0;
      result.lanternVoteTotals = await totals.lanterns();
    }
    if (current.votingStatus === 'open') admission.open(current);
    else admission.close(current);
    res.json({ status: 'success', data: await settingsResponse(req, publicControls(current), result) });
  } catch (error) {
    // A rejected command has no committed transition. Restore admission only
    // for a confirmed validation/authorization failure, never an uncertain commit.
    if (action === 'voting.close' && error.isOperational && error.statusCode < 500) {
      const current = await getControls();
      if (current.votingStatus === 'open') admission.open(current);
    }
    throw error;
  } finally { commandBusy = false; }
});
