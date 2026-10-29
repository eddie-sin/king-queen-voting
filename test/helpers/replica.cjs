const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { MongoClient } = require('mongoose').mongo;
const sleep = ms => new Promise(r => setTimeout(r, ms));
exports.freePort = async (host = '127.0.0.1') => {
  const s = net.createServer();
  await new Promise((r, j) => { s.once('error', j); s.listen(0, host, r); });
  const port = s.address().port;
  await new Promise(r => s.close(r));
  return port;
};
exports.initialize = async (client, port, name = 'isolatedTests') => {
  await client.db('admin').command({ replSetInitiate: { _id: name, members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
  for (let n = 0; n < 100; n++) {
    if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) return;
    await sleep(100);
  }
  throw new Error('Temporary replica did not become primary');
};
exports.start = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kqv-isolated-replica-'));
  const port = await exports.freePort();
  const proc = spawn(process.env.MONGOD_BINARY || 'mongod', ['--bind_ip','127.0.0.1','--port',String(port),'--replSet','isolatedTests','--dbpath',directory,'--logpath',path.join(directory,'mongo.log')], {stdio:'ignore'});
  let failure; proc.on('error', e => { failure = e; });
  const exited = new Promise(r => proc.once('exit', r));
  const close = async () => { if (proc.pid && proc.exitCode === null) { proc.kill('SIGTERM'); await exited; } await fs.rm(directory, {recursive:true,force:true}); };
  const client = new MongoClient(`mongodb://127.0.0.1:${port}`, {directConnection:true,serverSelectionTimeoutMS:300});
  try {
    for (let n = 0; ; n++) {
      try { await client.connect(); break; }
      catch { if (failure || proc.exitCode !== null || n >= 60) throw new Error('Could not start temporary MongoDB; set MONGOD_BINARY.'); await sleep(100); }
    }
    await exports.initialize(client, port);
  } catch (error) { await close(); throw error; }
  finally { await client.close(); }
  return { uri: `mongodb://127.0.0.1:${port}/?replicaSet=isolatedTests`, close };
};
