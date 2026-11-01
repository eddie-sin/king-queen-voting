const AppError = require('../utils/appError');
let active = 0;
const pending = [];
const owners = new Map();
const recent = new Map();
function pump() {
  while (active < 1 && pending.length) pending.shift().start();
}
module.exports = (req, res, next) => {
  const owner = String(req.userId || req.admin?._id || '');
  if (!owner || (owners.get(owner)||0) >= 3 || pending.length >= 8) {
    res.set('Retry-After', '5'); return next(new AppError('An image upload is busy. Keep your preview and try again shortly.', (owners.get(owner)||0)>=3 ? 409 : 429));
  }
  const now=Date.now();for(const [id,v] of recent)if(v.until<=now)recent.delete(id);
  let budget=recent.get(owner);
  if(!budget){if(recent.size>=4096){res.set('Retry-After','60');return next(new AppError('Image uploads are busy. Please retry shortly.',429));}budget={count:0,until:now+60000};recent.set(owner,budget);}
  if(++budget.count>20){res.set('Retry-After','60');return next(new AppError('Please wait a minute before uploading more images. Your preview is still here.',429));}
  owners.set(owner,(owners.get(owner)||0)+1);
  let started = false, done = false, timer;
  const release = () => {
    if (done) return; done = true; clearTimeout(timer); const count=(owners.get(owner)||1)-1; if(count) owners.set(owner,count); else owners.delete(owner);
    const index = pending.indexOf(item); if (index >= 0) pending.splice(index, 1);
    if (started) active--; pump();
  };
  const item = { start() { if (done) return; started = true; active++; clearTimeout(timer); next(); } };
  res.once('finish', release);
  // Do not free an active processing slot on client disconnect: decode/storage may still be running.
  res.once('close', () => { if (!started || !req.uploadProcessing || res.writableFinished) release(); });
  req.releaseUpload = release;
  // Controllers/parser call this after work ends, including disconnected/error requests.
  timer = setTimeout(() => { if (!started) { release(); next(new AppError('Image uploads are busy. Please try again shortly.', 429)); } }, 6000);
  pending.push(item); pump();
};
