const crypto = require('crypto');
const Controls = require('../model/eventControlsModel');
const Admin = require('../model/adminsModel');
const Action = require('../model/adminActionsModel');
const AppError = require('./appError');
const { can } = require('./permissions');
const { transaction } = require('./transactions');
exports.getControls = async session => {
  const controls = await Controls.findById('event').select('+fence').session(session || null);
  if (!controls || controls.schemaVersion !== 2) throw new AppError('Event controls are not initialized for this version.', 503);
  return controls;
};
exports.publicControls = controls => ({
  lanternVotingOpen: controls.lanternVotingOpen, lanternAnnouncementOpen: controls.lanternAnnouncementOpen, lanternWindow: controls.lanternWindow,
  wishPostingOpen: controls.wishPostingOpen !== false, registrationOpen: controls.registrationOpen, votingStatus: controls.votingStatus,
  announcementOpen: controls.announcementOpen, memoryPhotosEnabled: controls.memoryPhotosEnabled,
  round: controls.round, window: controls.window, revision: controls.revision,
  candidateManagementLocked: controls.votingStatus !== 'closed' || controls.announcementOpen,
});
exports.requireCandidateChanges = controls => {
  if (controls.votingStatus !== 'closed' || controls.announcementOpen) {
    throw new AppError('Close voting and hide announcement before changing candidates.', 409);
  }
};
exports.authorizeStaff = async (identity, permission, session) => {
  const account = await Admin.findById(identity?._id).session(session || null);
  if (!account || account.tokenVersion !== identity.tokenVersion) throw new AppError('Your staff session has expired.', 401);
  if (!can(account, permission) || permission === 'admin' && account.role !== 'admin') {
    throw new AppError('You do not have permission for this action.', 403);
  }
  return account;
};
exports.audit = (session, actor, action, details = {}, operationId = crypto.randomUUID()) => Action.create([{
  operationId, actor: actor._id, actorName: actor.username, action, details,
}], { session });
exports.withControls = callback => transaction(async session => {
  const controls = await exports.getControls(session);
  const result = await callback({ session, controls });
  // A real write makes otherwise disjoint ballot/settings changes conflict.
  controls.fence += 1;
  await controls.save({ session });
  return result;
});
exports.staffMutation = (req, permission, callback) => exports.withControls(async context => {
  const actor = await exports.authorizeStaff(req.admin, permission, context.session);
  return callback({ ...context, actor });
});
