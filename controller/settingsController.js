const Action = require('../model/adminActionsModel');
const Ballot = require('../model/ballotsModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { getControls, publicControls, staffMutation, withControls, audit, authorizeStaff } = require('../utils/eventControls');
const admission = require('../utils/voteAdmission');
const { can } = require('../utils/permissions');
const ACTIONS = ['registration.open', 'registration.close', 'voting.open', 'voting.close', 'announcement.open', 'announcement.close', 'votes.clear', 'memory.open', 'memory.close', 'lantern.open', 'lantern.close', 'lantern.announce', 'lantern.hide', 'wishes.open', 'wishes.close'];
let commandBusy = false;
const settingsResponse = async (req, controls, result) => {
  const data = { controls };
  // Re-read live permissions, including after a command or receipt replay.
  // A cleared-ballot count is also a private total; do not expose an alias.
  if (req.admin && can(await authorizeStaff(req.admin), 'votes.read')) {
    data.ballotCount = await Ballot.countDocuments({});
    if (result && Object.hasOwn(result, 'clearedBallots')) data.clearedBallots = result.clearedBallots;
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
  if (!ACTIONS.includes(action) || Object.keys(req.body || {}).some(k => !['revision', 'operationId', 'confirmation'].includes(k))
    || !Number.isSafeInteger(revision) || revision < 0 || typeof operationId !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(operationId)) throw new AppError('Refresh controls before performing this action.', 400);
  if (action === 'votes.clear' && confirmation !== 'CLEAR ALL VOTES') throw new AppError('Confirm by entering CLEAR ALL VOTES.', 400);
  const permission = action.startsWith('wishes.') ? 'admin' : action;
  await authorizeStaff(req.admin, permission);
  if (commandBusy) throw new AppError('Another control is being updated. Refresh and retry shortly.', 409);
  commandBusy = true;
  try {
    // Validate before stopping admissions. The transaction rechecks all authority/state.
    const before = await getControls();
    const previous = await Action.findOne({ operationId }).lean();
    if (!previous && before.revision !== revision) throw new AppError('Controls changed in another session. Refresh and try again.', 409);
    if (previous && !(action === 'voting.close' && before.votingStatus === 'closing' && previous.details?.window === before.window)) {
      if (String(previous.actor) !== String(req.admin._id) || previous.action !== action) throw new AppError('This operation ID was already used.', 409);
      const current = await staffMutation(req, permission, async ({ controls }) => publicControls(controls));
      if (action === 'voting.open' && current.votingStatus === 'open' && current.window === previous.details?.window) admission.open();
      return res.json({ status: 'success', data: await settingsResponse(req, current, { clearedBallots: previous.details?.clearedBallots || 0 }) });
    }
    if (action === 'voting.close') admission.close();
    const result = await staffMutation(req, permission, async ({ controls, session, actor }) => {
      const existing = await Action.findOne({ operationId }).session(session);
      if (existing) {
        if (String(existing.actor) !== String(actor._id) || existing.action !== action) throw new AppError('This operation ID was already used.', 409);
        return { clearedBallots: existing.details?.clearedBallots || 0 };
      }
      if (controls.revision !== revision) throw new AppError('Controls changed. Refresh and try again.', 409);
      let clearedBallots = 0;
      switch (action) {
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
          if (controls.votingStatus !== 'closed') throw new AppError('Voting must be fully closed first.', 409);
          require('../utils/voteTotals').awards(await require('../utils/voteTotals').candidates(controls,session));
          controls.announcementOpen = true; break;
        case 'announcement.close': controls.announcementOpen = false; break;
        case 'votes.clear':
          if (controls.votingStatus !== 'closed' || controls.announcementOpen) throw new AppError('Close voting and hide announcement before clearing votes.', 409);
          clearedBallots = (await Ballot.deleteMany({}).session(session)).deletedCount;
          controls.round++; break;
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
        case 'memory.open': controls.memoryPhotosEnabled = true; break;
        case 'memory.close': controls.memoryPhotosEnabled = false; break;
      }
      require('../utils/publicCalculations').clear();
      controls.revision++;
      await audit(session, actor, action, { round: controls.round, window: controls.window, clearedBallots }, operationId);
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
    if (current.votingStatus === 'open') admission.open();
    else admission.close();
    res.json({ status: 'success', data: await settingsResponse(req, publicControls(current), result) });
  } catch (error) {
    // A rejected command has no committed transition. Restore admission only
    // for a confirmed validation/authorization failure, never an uncertain commit.
    if (action === 'voting.close' && error.isOperational && error.statusCode < 500) {
      const current = await getControls();
      if (current.votingStatus === 'open') admission.open();
    }
    throw error;
  } finally { commandBusy = false; }
});
