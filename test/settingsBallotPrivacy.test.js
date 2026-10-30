const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const mongoose = require('mongoose');

// This suite owns a new mongod process, replica set and directory. Never dotenv.
const directory = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'settings-ballot-privacy-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.ADMIN_USERNAME = 'privacy-root';
process.env.ADMIN_PASSWORD = crypto.randomBytes(24).toString('base64url');
process.env.AUTH_ORIGIN = 'http://localhost:5173';
process.env.AUTH_OTP_SECRET = crypto.randomBytes(32).toString('hex');
process.env.AUTH_MAIL_SECRET = crypto.randomBytes(32).toString('hex');
process.env.GOOGLE_CLIENT_ID_DEVELOPMENT = 'privacy-fixture.apps.googleusercontent.com';
process.env.RESEND_API_KEY = 'fixture-not-used';
process.env.MEMORY_PHOTO_STORAGE = 'local';
process.env.LOCAL_UPLOAD_DIR = path.join(directory, 'public');
process.env.MEMORY_PHOTO_UPLOAD_DIR = path.join(directory, 'private');
const Ballot = require('../model/ballotsModel');
const password = crypto.randomBytes(24).toString('base64url');
const tokens = {}, ids = {}, candidates = [];
const noReadPermissions = ['registration.open', 'registration.close', 'votes.clear'];
let mongo, mongoExit, server, serverExit, base;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
});
async function request(method, endpoint, token, body, expected = 200) {
  const student = token && typeof token === 'object';
  const response = await fetch(base + '/api/v1' + endpoint, { method,
    headers: { ...(typeof token === 'string' ? { Authorization: `Bearer ${token}` } : {}),
      ...(student ? { Cookie: token.cookie, Origin: process.env.AUTH_ORIGIN, 'X-CSRF-Token': token.csrf } : {}),
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: body instanceof FormData?body:JSON.stringify(body) } : {}) });
  assert.equal(response.status, expected, `${method} ${endpoint}`);
  return response.json();
}
const settings = async token => (await request('GET', token ? '/admin/settings' : '/settings', token)).data;
async function command(action, token, body) {
  const payload = body || { revision: (await settings(token)).controls.revision, operationId: crypto.randomUUID() };
  return { payload, data: (await request('POST', '/admin/controls/' + action, token, payload)).data };
}
const onlyControls = data => {
  assert.deepEqual(Object.keys(data), ['controls'], 'No private count or alternate count field may be returned');
  assert.deepEqual(Object.keys(data.controls).sort(), [
    'announcementOpen', 'candidateManagementLocked', 'lanternAnnouncementOpen', 'lanternVotingOpen', 'lanternWindow',
    'memoryPhotosEnabled', 'registrationOpen', 'revision', 'round', 'votingStatus', 'window', 'wishPostingOpen',
  ], 'Public controls must not contain nested private totals');
  assert.equal(typeof data.controls.votingStatus, 'string');
};
async function castBothCategories() {
  await command('voting.open', tokens.admin);
  const controls = (await settings()).controls;
  for (const candidate of candidates) await request('POST', '/voting/submit', tokens.student,
    { candidateId: candidate._id, contest: candidate.category, round: controls.round, window: controls.window }, 201);
  await command('voting.close', tokens.admin);
}

before(async () => {
  const port = await freePort();
  const dbPath = path.join(directory, 'mongo'); await fs.mkdir(dbPath);
  mongo = spawn(process.env.MONGOD_BINARY || 'mongod', ['--bind_ip', '127.0.0.1', '--port', String(port),
    '--replSet', 'ballotPrivacyTest', '--dbpath', dbPath, '--logpath', path.join(directory, 'mongod.log')], { stdio: 'ignore', windowsHide: true });
  let spawnError; mongo.on('error', error => { spawnError = error; });
  mongoExit = new Promise(resolve => mongo.once('exit', resolve));
  const client = new mongoose.mongo.MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 300 });
  try {
    for (let attempt = 0; ; attempt++) {
      try { await client.connect(); break; } catch {
        if (spawnError || mongo.exitCode !== null || attempt > 80) throw Error('Could not start this suite\'s disposable MongoDB');
        await sleep(100);
      }
    }
    await client.db('admin').command({ replSetInitiate: { _id: 'ballotPrivacyTest', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    for (let attempt = 0; ; attempt++) {
      if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) break;
      if (attempt > 120) throw Error('Disposable replica set did not elect a primary');
      await sleep(100);
    }
  } finally { await client.close(); }
  const database = 'settings_ballot_privacy_' + crypto.randomBytes(6).toString('hex');
  const uri = `mongodb://127.0.0.1:${port}/${database}?replicaSet=ballotPrivacyTest`;
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
  // Own the API process too: its password-worker pool must not outlive the suite.
  const bootstrap = `
    const mongoose = require(${JSON.stringify(require.resolve('mongoose'))});
    const app = require(${JSON.stringify(require.resolve('../app'))});
    mongoose.connect(process.env.DATABASE_LOCAL, {autoCreate:false, autoIndex:false})
      .then(() => require(${JSON.stringify(require.resolve('../utils/seed'))}).seed())
      .then(() => { const server = app.listen(0, '127.0.0.1', () => process.send({port:server.address().port})); })
      .catch(() => process.exit(1));
  `;
  server = spawn(process.execPath, ['-e', bootstrap], { env: { ...process.env, DATABASE_LOCAL: uri },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  serverExit = new Promise(resolve => server.once('exit', resolve));
  const apiPort = await new Promise((resolve, reject) => {
    server.once('message', message => resolve(message.port));
    server.once('error', () => reject(Error('Disposable API could not start')));
    server.once('exit', () => reject(Error('Disposable API exited before readiness')));
  });
  base = `http://127.0.0.1:${apiPort}`;
  tokens.admin = (await request('POST', '/auth/admin/login', null,
    { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD })).data.token;
  for (const [name, role, permissions] of [
    ['reader', 'voting_admin', [...noReadPermissions, 'votes.read']],
    ['nonreader', 'voting_admin', noReadPermissions],
    ['memory', 'memory_admin', ['memory.open', 'memory.close']],
    ['lantern', 'lantern_admin', ['lantern.open', 'lantern.close']],
  ]) {
    ids[name] = (await request('POST', '/admin/staff', tokens.admin, { username: name, password, role, permissions }, 201)).data.admin.id;
    tokens[name] = (await request('POST', '/auth/admin/login', null, { username: name, password })).data.token;
  }
  const studentId = new mongoose.Types.ObjectId();
  const raw = crypto.randomBytes(32).toString('hex'); const browser = crypto.randomBytes(32).toString('hex'); const expiry = Date.now() + 86400000;
  const mac = value => crypto.createHmac('sha256', process.env.AUTH_OTP_SECRET).update(value).digest('hex');
  await mongoose.connection.collection('users').insertOne({ _id: studentId, email: 'privacystudent@gmail.com', emailKey: 'privacystudent@gmail.com', emailVerifiedAt: new Date(), status: 'active', tokenVersion: 0, createdAt: new Date(), updatedAt: new Date() });
  await mongoose.connection.collection('studentsessions').insertOne({ _id: crypto.createHash('sha256').update(raw).digest('hex'), user: studentId, version: 0, expiresAt: new Date(Date.now() + 3600000) });
  tokens.student = { cookie: `kq_session=${raw}; kq_browser=${browser}.${expiry}.${mac(`browser:${browser}:${expiry}`)}`, csrf: mac(`csrf:${browser}`) };
  for (const category of ['king','queen']) {const form=new FormData();form.append('data',JSON.stringify({fullName:`Privacy ${category}`,category}));form.append('images',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')],{type:'image/png'}),'photo.png');candidates.push((await request('POST','/candidates',tokens.admin,form,201)).data.candidate);}
  await castBothCategories();
}, { timeout: 60000 });

after(async () => {
  if (server?.pid && server.exitCode === null) { server.kill('SIGTERM'); await serverExit; }
  await mongoose.disconnect();
  if (mongo?.pid && mongo.exitCode === null) { mongo.kill('SIGTERM'); await mongoExit; }
  // The entire database lives in the mkdtemp directory owned by this test.
  assert.equal(path.dirname(directory), os.tmpdir());
  assert(path.basename(directory).startsWith('settings-ballot-privacy-'));
  await fs.rm(directory, { recursive: true, force: true });
});

test('public settings keep controls and omit all private totals', async () => onlyControls(await settings()));

test('ADMIN and voting staff granted votes.read receive accurate ballot totals', async () => {
  assert.equal(await Ballot.countDocuments({}), 2);
  for (const role of ['admin', 'reader']) assert.equal((await settings(tokens[role])).ballotCount, 2);
});

test('MEMORY_ADMIN, LANTERN_ADMIN and voting staff without votes.read receive controls only', async () => {
  for (const role of ['memory', 'lantern', 'nonreader']) onlyControls(await settings(tokens[role]));
  onlyControls((await request('GET', '/admin/settings?role=admin&permissions=votes.read', tokens.memory)).data);
});

test('specialized admins retain their feature commands without normal or replayed count disclosure', async () => {
  for (const [role, feature, field] of [['memory', 'memory', 'memoryPhotosEnabled'], ['lantern', 'lantern', 'lanternVotingOpen']]) {
    const first = await command(feature + '.open', tokens[role]);
    onlyControls(first.data); assert.equal(first.data.controls[field], true);
    const replay = await command(feature + '.open', tokens[role], first.payload);
    onlyControls(replay.data); assert.equal(replay.data.controls.revision, first.data.controls.revision);
    onlyControls((await command(feature + '.close', tokens[role])).data);
  }
});

test('voting staff without votes.read can control registration without seeing totals', async () => {
  const first = await command('registration.open', tokens.nonreader);
  onlyControls(first.data); onlyControls((await command('registration.open', tokens.nonreader, first.payload)).data);
  onlyControls((await command('registration.close', tokens.nonreader)).data);
});

test('authorized normal and replay command responses retain their count contract', async () => {
  for (const role of ['admin', 'reader']) {
    const first = await command('registration.close', tokens[role]);
    for (const data of [first.data, (await command('registration.close', tokens[role], first.payload)).data]) {
      assert.equal(data.ballotCount, 2); assert.equal(data.clearedBallots, 0);
    }
  }
});

test('grant and revocation affect settings and existing command receipts without a new login', async () => {
  const first = await command('registration.close', tokens.nonreader);
  await request('PATCH', '/admin/staff/' + ids.nonreader, tokens.admin, { permissions: [...noReadPermissions, 'votes.read'] });
  assert.equal((await settings(tokens.nonreader)).ballotCount, 2);
  assert.equal((await command('registration.close', tokens.nonreader, first.payload)).data.ballotCount, 2);
  await request('PATCH', '/admin/staff/' + ids.nonreader, tokens.admin, { permissions: noReadPermissions });
  onlyControls(await settings(tokens.nonreader)); onlyControls((await command('registration.close', tokens.nonreader, first.payload)).data);
});

test('protected settings still reject anonymous and student sessions', async () => {
  await request('GET', '/admin/settings', null, null, 401);
  await request('GET', '/admin/settings', tokens.student, null, 401);
});

test('public result announcements remain available with legitimate title vote counts', async () => {
  await command('announcement.open', tokens.admin);
  const result = (await request('GET', '/results')).data.results;
  assert.equal(result.kings[0].votes, 1); assert.equal(result.queens[0].votes, 1);
  await command('announcement.close', tokens.admin);
});

test('votes.clear without votes.read works but neither its result nor receipt reveals cleared totals', async () => {
  const first = await command('votes.clear', tokens.nonreader, {
    revision: (await settings(tokens.nonreader)).controls.revision, operationId: crypto.randomUUID(), confirmation: 'CLEAR ALL VOTES',
  });
  onlyControls(first.data); assert.equal(await Ballot.countDocuments({}), 0);
  await castBothCategories();
  onlyControls((await command('votes.clear', tokens.nonreader, first.payload)).data);
  assert.equal(await Ballot.countDocuments({}), 2, 'Receipt replay must not clear newer ballots');
});

test('ADMIN clear and retry preserve accurate authorized remaining and cleared totals', async () => {
  if (await Ballot.countDocuments({}) === 0) await castBothCategories();
  const first = await command('votes.clear', tokens.admin, {
    revision: (await settings(tokens.admin)).controls.revision, operationId: crypto.randomUUID(), confirmation: 'CLEAR ALL VOTES',
  });
  for (const data of [first.data, (await command('votes.clear', tokens.admin, first.payload)).data]) {
    assert.equal(data.ballotCount, 0); assert.equal(data.clearedBallots, 2);
  }
});
