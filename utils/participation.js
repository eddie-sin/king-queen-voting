const User = require('../model/usersModel');
const { getControls } = require('./eventControls');
const AppError = require('./appError');
exports.allowed = (controls, user) => controls.participationRequired !== true || user.participationEnabled === true;
exports.require = async (req, controls, session) => {
  const user = await User.findOne({ _id: req.userId, status: 'active', emailVerifiedAt: {$exists:true}, tokenVersion: req.user.tokenVersion }).session(session || null);
  if (!user) throw new AppError('Your account session has ended. Sign in again.', 401);
  if (!exports.allowed(controls, user)) throw Object.assign(new AppError('Participation access is not enabled for your account. Please contact the festival organisers.',403), { reason: 'PARTICIPATION_REQUIRED' });
  return user;
};
exports.preflight = require('./catchAsync')(async(req,res,next)=>{ await exports.require(req, await getControls()); next(); });
