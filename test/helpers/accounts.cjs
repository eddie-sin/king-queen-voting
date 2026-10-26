// Explicit cookie fixtures for non-auth feature tests; never loads a private config.
const crypto = require('node:crypto');
process.env.AUTH_ENVIRONMENT = 'local';
process.env.AUTH_ORIGIN = 'http://localhost:5173';
process.env.AUTH_OTP_SECRET = crypto.randomBytes(32).toString('hex');
process.env.AUTH_MAIL_SECRET = crypto.randomBytes(32).toString('hex');
process.env.AUTH_TEST_MODE = 'true';
const security = require('../../utils/accounts/security');
const { Session } = require('../../model/studentAuthModels');
exports.createUser = input => {
  const verified = x => ({ ...x, emailKey: x.email.toLowerCase(), emailVerifiedAt: new Date() });
  return require('../../model/usersModel').create(Array.isArray(input) ? input.map(verified) : verified(input));
};
exports.studentToken = async (user, {expired = false} = {}) => {
  const raw = await security.issue(user);
  if (expired) await Session.updateOne({_id:security.digest(raw)}, {$set:{expiresAt:new Date(0)}});
  return raw;
};
const browser = security.random(), expiry = Date.now() + 86400000;
exports.headers = token => ({
  Origin: process.env.AUTH_ORIGIN,
  'X-CSRF-Token': security.csrf(browser),
  ...(token ? /^[a-f0-9]{64}$/.test(token) ? {Cookie:`kq_session=${token}; kq_browser=${browser}.${expiry}.${security.mac(`browser:${browser}:${expiry}`)}`} : {Authorization:`Bearer ${token}`} : {}),
});
