// Isolated local development replica set. Never deletes data or manages an unverified MongoDB process.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { MongoClient } = require('mongoose').mongo;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function configuration(env = process.env, platform = process.platform) {
  const port = Number(env.KQV_MONGO_PORT || 27018);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('KQV_MONGO_PORT must be an integer from 1024 to 65535.');
  const defaultRoot = platform === 'win32'
    ? path.join(env.LOCALAPPDATA || os.tmpdir(), 'king-queen-voting-v2')
    : path.join(os.homedir(), '.local', 'share', 'king-queen-voting-v2');
  const replicaSet = env.KQV_MONGO_REPLICA_SET || 'kqvLocal';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(replicaSet)) throw new Error('KQV_MONGO_REPLICA_SET contains unsupported characters.');
  const directory = path.resolve(env.KQV_MONGO_DBPATH || defaultRoot);
  return {
    host: '127.0.0.1', port, directory, replicaSet, binary: env.MONGOD_BINARY || 'mongod',
    logPath: path.join(directory, 'mongod.log'), pidPath: path.join(directory, 'mongod.pid'),
    uri: 'mongodb://127.0.0.1:' + port + '/?directConnection=true', member: '127.0.0.1:' + port,
  };
}
function mongodArguments(config, platform = process.platform) {
  const args = ['--bind_ip', config.host, '--port', String(config.port), '--replSet', config.replicaSet,
    '--dbpath', config.directory, '--logpath', config.logPath, '--logappend'];
  if (platform !== 'win32') args.push('--fork');
  return args;
}
function samePath(left, right, platform = process.platform) {
  const normalize = value => {
    const resolved = path.resolve(String(value || ''));
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}
function validateOwnedOptions(options, config, platform = process.platform) {
  const parsed = options?.parsed || {};
  if (!samePath(parsed.storage?.dbPath, config.directory, platform)) {
    throw new Error("Port " + config.port + " is not this project's isolated server; no process was changed.");
  }
  const effectiveReplicaSet = parsed.replication?.replSetName || parsed.replication?.replSet;
  if (Number(parsed.net?.port) !== config.port || effectiveReplicaSet !== config.replicaSet) {
    throw new Error('Port ' + config.port + ' has different MongoDB startup settings; no process was changed.');
  }
}
async function portIsOpen(config) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}
async function connect(config, timeout = 1000) {
  const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: timeout });
  try { await client.connect(); return client; } catch (error) { await client.close().catch(() => {}); throw error; }
}
async function ownedClient(config, timeout = 1000) {
  const client = await connect(config, timeout);
  try {
    validateOwnedOptions(await client.db('admin').command({ getCmdLineOpts: 1 }), config);
    return client;
  } catch (error) { await client.close(); throw error; }
}
async function waitForClient(config, child) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child && child.exitCode !== null) throw new Error('mongod exited with code ' + child.exitCode + '. Inspect ' + config.logPath + '.');
    try { return await ownedClient(config, 500); } catch (error) { lastError = error; }
    await sleep(250);
  }
  throw new Error('MongoDB did not become ready on ' + config.member + ': ' + (lastError?.message || 'startup timed out') + '. Inspect ' + config.logPath + '.');
}
async function launch(config, platform = process.platform) {
  fs.mkdirSync(config.directory, { recursive: true, mode: 0o700 });
  const args = mongodArguments(config, platform);
  if (platform !== 'win32') {
    const result = spawnSync(config.binary, args, { encoding: 'utf8' });
    if (result.error) throw new Error('Could not execute mongod: ' + result.error.message);
    if (result.status !== 0) throw new Error('Could not start isolated MongoDB: ' + ((result.stderr || result.stdout || '').trim() || ('inspect ' + config.logPath)));
    return null;
  }
  const child = spawn(config.binary, args, { detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => {
    const ready = () => { child.off('error', reject); resolve(); };
    child.once('spawn', ready); child.once('error', reject);
  }).catch(error => { throw new Error('Could not execute mongod: ' + error.message); });
  fs.writeFileSync(config.pidPath, String(child.pid), { encoding: 'utf8', mode: 0o600 });
  child.unref();
  return child;
}
async function ensureReplicaSet(client, config) {
  const admin = client.db('admin');
  let status;
  try { status = await admin.command({ replSetGetStatus: 1 }); }
  catch (error) {
    if (error.code !== 94 && error.codeName !== 'NotYetInitialized') throw error;
    await admin.command({ replSetInitiate: { _id: config.replicaSet, members: [{ _id: 0, host: config.member }] } });
  }
  if (status?.set && status.set !== config.replicaSet) throw new Error('Server belongs to replica set ' + status.set + ', not ' + config.replicaSet + '.');
  for (let attempt = 0; attempt < 80; attempt++) {
    if ((await admin.command({ hello: 1 })).isWritablePrimary) return;
    await sleep(250);
  }
  throw new Error('Replica set was found but did not become writable.');
}
async function start(config, platform = process.platform) {
  let client;
  try {
    client = await ownedClient(config);
    console.log('Local MongoDB is already running on ' + config.member + '; validating replica set.');
  } catch {
    if (await portIsOpen(config)) throw new Error("Port " + config.port + " is occupied and could not be verified as this project's MongoDB; nothing was started.");
    console.log('Starting isolated MongoDB on ' + config.member + ' using ' + config.directory + '.');
    const child = await launch(config, platform);
    client = await waitForClient(config, child);
  }
  try {
    await ensureReplicaSet(client, config);
    console.log('Local v2 MongoDB ready on ' + config.member + ' (' + config.replicaSet + ').');
    console.log('Development URI: mongodb://' + config.member + '/king_queen_voting_v2?replicaSet=' + config.replicaSet);
  } finally { await client.close(); }
}
async function stop(config) {
  let client;
  try { client = await ownedClient(config); }
  catch {
    if (!await portIsOpen(config)) { console.log('Local MongoDB is already stopped on ' + config.member + '.'); return; }
    throw new Error("Port " + config.port + " is occupied but is not this project's verified MongoDB; nothing was stopped.");
  }
  console.log('Stopping verified local MongoDB on ' + config.member + '.');
  try { await client.db('admin').command({ shutdown: 1, force: false }); }
  catch (error) { if (!/closed|connection|socket|network|ECONN/i.test(error.message)) throw error; }
  finally { await client.close().catch(() => {}); }
  for (let attempt = 0; attempt < 40 && await portIsOpen(config); attempt++) await sleep(250);
  if (await portIsOpen(config)) throw new Error('MongoDB on ' + config.member + ' did not stop; inspect ' + config.logPath + '.');
  try { fs.unlinkSync(config.pidPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log('Local MongoDB stopped. Data remains in ' + config.directory + '.');
}
async function status(config) {
  let client;
  try { client = await ownedClient(config); }
  catch {
    if (!await portIsOpen(config)) { console.log('Local MongoDB is stopped on ' + config.member + '. Data remains in ' + config.directory + '.'); return; }
    throw new Error('Port ' + config.port + ' is occupied by an unverified service.');
  }
  try {
    const hello = await client.db('admin').command({ hello: 1 });
    console.log('Local MongoDB is running on ' + config.member + '; replica set ' + config.replicaSet + ' is ' + (hello.isWritablePrimary ? 'ready' : 'not yet writable') + '.');
  } finally { await client.close(); }
}
async function main() {
  const config = configuration();
  const command = process.argv[2] || 'start';
  if (command === 'start') return start(config);
  if (command === 'stop') return stop(config);
  if (command === 'restart') { await stop(config); return start(config); }
  if (command === 'status') return status(config);
  throw new Error('Usage: node scripts/localMongo.cjs [start|stop|restart|status]');
}
module.exports = { configuration, mongodArguments, samePath, validateOwnedOptions, portIsOpen, start, stop, status };
if (require.main === module) main().catch(error => { console.error('Local MongoDB error: ' + error.message); process.exitCode = 1; });
