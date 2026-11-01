const AppError = require('./appError');
// One API process only. Never carry queued work across a close/reopen boundary.
let blocked = true;
let observedWindow = null;
let observedRevision = -1;
let locallyClosedWindow = null;
const windowKey = controls => controls ? `${controls.round}:${controls.window}` : null;
let active = 0;
const waiting = [];
const drained = new Set();
const MAX_ACTIVE = 4;
const MAX_WAITING = 256;
const unavailable = () => new AppError('Voting is closed. Your vote was not started.', 409);
function pump() {
  while (!blocked && active < MAX_ACTIVE && waiting.length) {
    const item = waiting.shift(); clearTimeout(item.timer);
    if (item.signal?.aborted) { item.reject(new AppError('Vote request cancelled before processing.', 409)); continue; }
    active++;
    Promise.resolve().then(item.work).then(item.resolve, item.reject).finally(() => {
      active--;
      if (!active) { for (const done of drained) done(); drained.clear(); }
      pump();
    });
  }
}
exports.open = controls => {
  if (controls) { observedWindow = windowKey(controls); observedRevision = Math.max(observedRevision, controls.revision ?? -1); }
  locallyClosedWindow = null;
  blocked = false; pump();
};
// Shared controls may be changed by another backend. Never reopen a window
// whose local close/drain has already begun, even if its DB update is pending.
exports.synchronize = controls => {
  // Concurrent status reads can finish out of order. Ignore older snapshots.
  if (Number.isSafeInteger(controls.revision) && controls.revision < observedRevision) return;
  observedRevision = Math.max(observedRevision, controls.revision ?? -1);
  const key = windowKey(controls);
  observedWindow = key;
  if (controls.votingStatus !== 'open' || controls.announcementOpen) {
    exports.close(controls); return;
  }
  if (locallyClosedWindow === key) return;
  blocked = false; pump();
};
exports.close = controls => {
  if (controls) observedRevision = Math.max(observedRevision, controls.revision ?? -1);
  locallyClosedWindow = windowKey(controls) || observedWindow;
  blocked = true;
  for (const item of waiting.splice(0)) { clearTimeout(item.timer); item.reject(unavailable()); }
};
exports.drain = () => active ? new Promise(resolve => drained.add(resolve)) : Promise.resolve();
exports.admit = (work, signal) => {
  if (blocked) return Promise.reject(unavailable());
  if (waiting.length >= MAX_WAITING) return Promise.reject(new AppError('Voting is busy. Please retry shortly.', 503));
  return new Promise((resolve, reject) => {
    const item = { work, resolve, reject, signal };
    item.timer = setTimeout(() => {
      const index = waiting.indexOf(item);
      if (index >= 0) { waiting.splice(index, 1); reject(new AppError('Voting is busy. This request was not started; please retry.', 503)); }
    }, 6000);
    waiting.push(item); pump();
  });
};
