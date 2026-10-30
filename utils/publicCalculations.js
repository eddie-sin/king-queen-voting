const entries = new Map();
exports.get = (key, work, ttl = 3000) => {
  const now = Date.now(), old = entries.get(key);
  if (old && old.until > now) return old.promise;
  for (const [k,v] of entries) if (v.until <= now) entries.delete(k);
  if (entries.size >= 16) entries.delete(entries.keys().next().value);
  const entry = {until:now+ttl};
  entry.promise = Promise.resolve().then(work).catch(error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
  entries.set(key,entry); return entry.promise;
};
exports.clear = () => entries.clear();

exports.invalidate = key => entries.delete(key);
