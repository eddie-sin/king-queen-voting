const jwt = require('jsonwebtoken');
const User = require('../model/usersModel');
const Admin = require('../model/adminsModel');
const Ballot = require('../model/ballotsModel');
const passwords = require('../utils/passwords');
const { staffResponse } = require('../utils/permissions');
const { getControls, withControls } = require('../utils/eventControls');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
let dummyHash;
async function userResponse(user) {
  const controls = await getControls();
  const votes = await Ballot.find({ user: user._id, round: controls.round }).select('contest').lean();
  return { id: String(user._id), email: user.email, round: controls.round,
    hasVotedKing: votes.some(v => v.contest === 'king'), hasVotedQueen: votes.some(v => v.contest === 'queen') };
}
function tokenResponse(account, kind) {
  const payload = { role: kind, v: account.tokenVersion, [kind === 'admin' ? 'adminId' : 'userId']: String(account._id) };
  return { token: jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '5h' }), tokenType: 'Bearer' };
}
function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new AppError('A valid email address is required.', 400);
  return value.trim().toLowerCase();
}
function only(body, fields) {
  if (!body || Array.isArray(body) || Object.keys(body).some(k => !fields.includes(k))) throw new AppError('Unexpected account fields.', 400);
}
async function checkPassword(password, account) {
  if (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) throw new AppError('Invalid login details.', 401);
  dummyHash ||= passwords.hash('unused-login-placeholder-password').catch(error => { dummyHash = null; throw error; });
  const fallback = await dummyHash;
  return passwords.compare(password, account?.passwordHash || fallback);
}
exports.register = catchAsync(async (req, res) => {
  only(req.body, ['email', 'password']);
  const email = emailAddress(req.body.email);
  passwords.validatePassword(req.body.password);
  if (!(await getControls()).registrationOpen) throw new AppError('Registration is closed.', 403);
  const passwordHash = await passwords.hash(req.body.password);
  const user = await withControls(async ({ controls, session }) => {
    if (!controls.registrationOpen) throw new AppError('Registration is closed.', 403);
    if (await User.exists({ email }).session(session)) throw new AppError('Email is already registered. Please sign in.', 409);
    return (await User.create([{ email, passwordHash }], { session }))[0];
  });
  res.status(201).json({ status: 'success', message: 'Account created. You can now sign in.', data: { user: await userResponse(user) } });
});
exports.login = catchAsync(async (req, res) => {
  only(req.body, ['email', 'password']);
  const email = emailAddress(req.body.email);
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!(await checkPassword(req.body.password, user)) || !user) throw new AppError('Invalid email or password.', 401);
  if (user.status !== 'active') throw new AppError('This account is disabled.', 403);
  res.json({ status: 'success', data: { ...tokenResponse(user, 'user'), user: await userResponse(user) } });
});
exports.adminLogin = catchAsync(async (req, res) => {
  only(req.body, ['username', 'password']);
  const username = passwords.username(req.body.username);
  const admin = await Admin.findOne({ username }).select('+passwordHash');
  if (!(await checkPassword(req.body.password, admin)) || !admin) throw new AppError('Invalid username or password.', 401);
  if (admin.status !== 'active' || !['admin', 'voting_admin'].includes(admin.role)) throw new AppError('This staff account is not active.', 403);
  res.json({ status: 'success', data: { ...tokenResponse(admin, 'admin'), admin: staffResponse(admin) } });
});
exports.getMe = catchAsync(async (req, res) => res.json({ status: 'success', data: { user: await userResponse(req.user) } }));
exports.getAdminMe = catchAsync(async (req, res) => res.json({ status: 'success', data: { admin: staffResponse(req.admin) } }));
