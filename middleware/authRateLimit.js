const AppError = require('../utils/appError');
const attempts = new Map();
const clean = setInterval(() => {
  const now = Date.now(); for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
}, 60000);
clean.unref();
function hit(key, limit, period) {
  const now = Date.now(); let entry = attempts.get(key);
  if (!entry || entry.until <= now) { entry = { count: 0, until: now + period }; attempts.set(key, entry); }
  if (++entry.count > limit) throw new AppError('Too many attempts. Please wait before trying again.', 429);
}
module.exports = kind => (req, res, next) => {
  try {
    // Generous shared-network ceiling: students may all use the event Wi-Fi.
    if (attempts.size > 20000) throw new AppError('Sign-in is busy. Please retry shortly.', 503);
    hit(`${kind}:ip:${req.ip}`, kind === 'config' ? 2000 : kind === 'register' ? 120 : 300, 60000);
    const identity = req.body?.[kind === 'staff' ? 'username' : 'email'];
    if (typeof identity === 'string' && identity.length <= 254) {
      let key = identity.trim().toLowerCase();
      if(kind !== 'staff') {
        try { key = require('../utils/accounts/config').gmail(identity).emailKey; } catch { /* Invalid input is rejected by the controller. */ }
      }
      hit(`${kind}:account:${key}`, kind === 'register' ? 5 : 15, 60000);
    }
    next();
  } catch (error) { res.set('Retry-After', '60'); next(error); }
};
