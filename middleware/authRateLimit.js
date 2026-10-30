const AppError = require('../utils/appError');
// Independent bounded stores: student churn cannot disable staff or configuration.
const stores = new Map();
const WINDOW = 60000;
function store(kind) { if (!stores.has(kind)) stores.set(kind, new Map()); return stores.get(kind); }
function hit(map, key, max, now) {
  let entry = map.get(key);
  if (!entry || entry.until <= now) {
    for (const [k, v] of map) if (v.until <= now) map.delete(k);
    // Do not evict live counters: that would let a caller reset its own limit.
    if (map.size >= 4096 && !map.has(key)) throw new AppError('This sign-in route is busy. Please retry shortly.', 429);
    entry = {count: 0, until: now + WINDOW}; map.set(key, entry);
  }
  if (++entry.count > max) throw new AppError('Too many attempts. Please wait before trying again.', 429);
}
module.exports = kind => (req, res, next) => {
  try {
    const now = Date.now();
    hit(store(kind + ':source'), String(req.ip), kind === 'config' ? 2000 : kind === 'register' ? 240 : kind === 'staff' ? 120 : 600, now);
    const identity = req.body?.[kind === 'staff' ? 'username' : 'email'];
    if (typeof identity === 'string' && identity.length <= 254) {
      let key = identity.trim().toLowerCase();
      if (kind !== 'staff') { try { key = require('../utils/accounts/config').gmail(identity).emailKey; } catch { throw new AppError('Use a valid @gmail.com address.', 400); } }
      // Account + source prevents a different network from trivially locking out an organiser.
      hit(store(kind + ':identity'), `${req.ip}:${key}`, kind === 'register' ? 5 : 15, now);
    }
    next();
  } catch (error) { res.set('Retry-After', '60'); next(error); }
};
