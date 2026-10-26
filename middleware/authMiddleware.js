const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../model/usersModel');
const Admin = require('../model/adminsModel');
const { can } = require('../utils/permissions');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const authenticate = (kind, permission) => catchAsync(async (req, res, next) => {
  if (kind === 'user') {
    const security = require('../utils/accounts/security');
    const { Session } = require('../model/studentAuthModels');
    const id = security.sessionId(req);
    const session = id && await Session.findOne({ _id:id, expiresAt: { $gt:new Date() } });
    const user = session && await User.findOne({ _id:session.user, tokenVersion:session.version, status:'active', emailVerifiedAt:{$exists:true} });
    if (!user) throw new AppError('Sign in to continue.',401);
    req.user=user; req.userId=String(user._id); req.studentSession=session;
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) return security.guard(req,res,next);
    return next();
  }
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !/^Bearer \S+$/.test(authorization)) throw new AppError('Sign in to continue.', 401);
  let decoded;
  try { decoded = jwt.verify(authorization.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] }); }
  catch { throw new AppError('Invalid or expired session. Please sign in again.', 401); }
  if (decoded.role !== kind || !Number.isSafeInteger(decoded.v)) throw new AppError('This session cannot access this area.', 401);
  const id = kind === 'admin' ? decoded.adminId : decoded.userId;
  if (typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id)) throw new AppError('Invalid session identity.', 401);
  const account = await (kind === 'admin' ? Admin : User).findById(id);
  if (!account || account.tokenVersion !== decoded.v) throw new AppError('Your session has expired. Please sign in again.', 401);
  if (account.status !== 'active') throw new AppError('This account is disabled.', 403);
  if (kind === 'admin') {
    if (!can(account, permission) || permission === 'admin' && account.role !== 'admin') throw new AppError('You do not have permission for this action.', 403);
    req.admin = account;
  } else { req.user = account; req.userId = String(account._id); }
  next();
});
module.exports = authenticate('user');
module.exports.staff = authenticate('admin');
module.exports.admin = authenticate('admin', 'admin');
module.exports.permission = permission => authenticate('admin', permission);
