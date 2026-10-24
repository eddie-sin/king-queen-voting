const { parentPort } = require('node:worker_threads');
const bcrypt = require('bcryptjs');
parentPort.on('message', async ({ id, operation, password, hash }) => {
  try {
    const result = operation === 'hash' ? await bcrypt.hash(password, 12) : await bcrypt.compare(password, hash);
    parentPort.postMessage({ id, result });
  } catch { parentPort.postMessage({ id, error: true }); }
});
