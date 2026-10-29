const { Worker } = require('node:worker_threads');
const path = require('node:path');
const AppError = require('./appError');
const waiting = [];
const slots = [];
let sequence = 0;
function pump() {
  for (const slot of slots) {
    if (slot.job || !waiting.length) continue;
    slot.job = waiting.shift(); clearTimeout(slot.job.timer);
    slot.worker.ref();
    const { id, operation, password, hash } = slot.job;
    slot.worker.postMessage({ id, operation, password, hash });
  }
}
function createSlot() {
  const slot = { worker: new Worker(path.join(__dirname, 'passwordWorker.js')), job: null };
  slot.worker.on('message', message => {
    const job = slot.job; if (!job || job.id !== message.id) return;
    slot.job = null; slot.worker.unref();
    if (message.error) job.reject(new AppError('Password processing is unavailable. Please retry.', 503));
    else job.resolve(message.result);
    pump();
  });
  slot.worker.on('error', () => {});
  slot.worker.on('exit', () => {
    if (slot.job) slot.job.reject(new AppError('Password processing was interrupted. Please retry.', 503));
    slots.splice(slots.indexOf(slot), 1);
    if (waiting.length) { slots.push(createSlot()); pump(); }
  });
  // Adding a message listener can re-reference a worker; unref only after wiring it.
  slot.worker.unref();
  return slot;
}
function run(operation, password, hash) {
  if (waiting.length >= 32) return Promise.reject(new AppError('Sign-in is busy. Please retry shortly.', 503));
  while (slots.length < 2) slots.push(createSlot());
  return new Promise((resolve, reject) => {
    const job = { id: ++sequence, operation, password, hash, resolve, reject };
    job.timer = setTimeout(() => {
      const index = waiting.indexOf(job);
      if (index >= 0) { waiting.splice(index, 1); reject(new AppError('Sign-in is busy. This request was not processed; please retry.', 503)); }
    }, 6000);
    waiting.push(job); pump();
  });
}
exports.hash = password => run('hash', password);
exports.compare = (password, hash) => run('compare', password, hash);
exports.validatePassword = password => {
  if (typeof password !== 'string' || !password.trim() || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new AppError('Password must be at least 8 characters and at most 72 UTF-8 bytes.', 400);
  }
};
exports.username = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value.trim())) {
    throw new AppError('Username must contain 1–100 letters, digits, dots, underscores or hyphens.', 400);
  }
  return value.trim().toLowerCase();
};
