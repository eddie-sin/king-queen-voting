const jwt = require('jsonwebtoken');
const Admin = require('../model/adminsModel');
const passwords = require('../utils/passwords');
const { staffResponse } = require('../utils/permissions');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
let dummyHash;
function tokenResponse(account, kind) {
  const payload = { role: kind, v: account.tokenVersion, [kind === 'admin' ? 'adminId' : 'userId']: String(account._id) };
  return { token: jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '5h' }), tokenType: 'Bearer' };
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
exports.adminLogin = catchAsync(async (req, res) => {
  only(req.body, ['username', 'password']);
  const username = passwords.username(req.body.username);
  const admin = await Admin.findOne({ username }).select('+passwordHash');
  if (!(await checkPassword(req.body.password, admin)) || !admin) throw new AppError('Invalid username or password.', 401);
  if (admin.status !== 'active' || !['admin', 'voting_admin', 'memory_admin', 'lantern_admin'].includes(admin.role)) throw new AppError('This staff account is not active.', 403);
  res.json({ status: 'success', data: { ...tokenResponse(admin, 'admin'), admin: staffResponse(admin) } });
});
exports.getAdminMe = catchAsync(async (req, res) => res.json({ status: 'success', data: { admin: staffResponse(req.admin) } }));
