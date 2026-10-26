const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { MongoClient } = require('mongoose').mongo;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
});

exports.createV2Fixture = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kqv-v2-fixture-'));
  const database = 'test_v2_' + crypto.randomBytes(6).toString('hex');
  const port = await freePort();
  const uri = `mongodb://127.0.0.1:${port}/${database}?replicaSet=testV2`;
  const secret = crypto.randomBytes(48).toString('hex');
  const password = crypto.randomBytes(24).toString('base64url');
  const dbPath = path.join(directory, 'mongo'); await fs.mkdir(dbPath);
  let mongo, mongoExit, api, apiExit, base, client, adminToken;
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(AWS_|DATABASE|JWT_|ADMIN_|NODE_OPTIONS|MEMORY_PHOTO_|LOCAL_UPLOAD_DIR|TEST_V2_)/.test(key)));
  Object.assign(environment, { NODE_ENV: 'test', TEST_V2_URI: uri, JWT_SECRET: secret, JWT_EXPIRES_IN: '1h', ADMIN_USERNAME: 'v2-root', ADMIN_PASSWORD: password,
    AUTH_ENVIRONMENT: 'local', AUTH_TEST_MODE: 'true', AUTH_ORIGIN: 'http://localhost:5173', AUTH_OTP_SECRET: crypto.randomBytes(32).toString('hex'),
    AUTH_MAIL_SECRET: crypto.randomBytes(32).toString('hex'), GOOGLE_CLIENT_ID_DEVELOPMENT: 'fixture.apps.googleusercontent.com', RESEND_API_KEY: 'fixture-not-used',
    MEMORY_PHOTO_STORAGE: 'local', MEMORY_PHOTO_ALLOW_SHARED_BUCKET: 'false', LOCAL_UPLOAD_DIR: path.join(directory, 'public'),
    MEMORY_PHOTO_UPLOAD_DIR: path.join(directory, 'private'), AWS_EC2_METADATA_DISABLED: 'true' });
  async function stopOwned(child, exited, label) {
    if (!child?.pid || child.exitCode !== null) return;
    child.kill('SIGTERM');
    if (await Promise.race([exited.then(() => true), sleep(5000).then(() => false)])) return;
    if (child.exitCode === null) child.kill('SIGKILL');
    if (!await Promise.race([exited.then(() => true), sleep(5000).then(() => false)])) {
      throw Error(`Disposable ${label} did not terminate`);
    }
  }
  async function stopApi() {
    await stopOwned(api, apiExit, 'v2 API');
    base = undefined; adminToken = undefined;
  }
  async function startApi() {
    api = spawn(process.execPath, [path.join(__dirname, 'v2ApiProcess.cjs')], { cwd: directory, env: environment,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    apiExit = new Promise(resolve => api.once('exit', resolve));
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Disposable v2 API readiness timed out')), 30000);
      api.once('message', message => { clearTimeout(timer); resolve(message); });
      api.once('error', () => { clearTimeout(timer); reject(Error('Disposable v2 API could not start')); });
      api.once('exit', () => { clearTimeout(timer); reject(Error('Disposable v2 API exited before readiness')); });
    });
    if (!result.ready) { await apiExit; throw Error(result.reason); }
    base = `http://127.0.0.1:${result.port}/api/v1`;
  }
  function assertOwnedDatabase() {
    assert(/^test_v2_[a-f0-9]{12}$/.test(database));
    assert.equal(client.db().databaseName, database);
  }
  function assertOwnedDirectory() {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert(path.basename(directory).startsWith('kqv-v2-fixture-'));
  }
  async function close() {
    await stopApi();
    await client?.close();
    await stopOwned(mongo, mongoExit, 'v2 MongoDB');
    assertOwnedDirectory();
    await fs.rm(directory, { recursive: true, force: true });
  }
  const fixture = {
    secret, password, database,
    get db() { return client.db(); }, get token() { return adminToken; },
    get baseUrl() { assert(base, 'API must be ready'); return base.replace(/\/api\/v1$/, ''); },
    get privateDirectory() { assertOwnedDirectory(); return path.join(directory, 'private'); },
    async request(method, endpoint, { token, body, headers = {} } = {}) {
      assert(base, 'API must be ready');
      const multipart = body instanceof FormData;
      const student = token && typeof token === 'object';
      const response = await fetch(base + endpoint, { method, headers: {
        ...(typeof token === 'string' ? { Authorization: `Bearer ${token}` } : {}),
        ...(student ? { Cookie: token.cookie, Origin: environment.AUTH_ORIGIN, 'X-CSRF-Token': token.csrf } : {}),
        ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}), ...headers,
      }, ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {}) });
      const type = response.headers.get('content-type') || '';
      return { status: response.status, headers: response.headers,
        ...(type.startsWith('image/') ? { bytes: Buffer.from(await response.arrayBuffer()) } : { body: response.status === 204 ? null : await response.json() }) };
    },
    async asset(endpoint) {
      assert(base, 'API must be ready');
      assert(/^\/uploads\/[A-Za-z0-9/_-]+\.[A-Za-z0-9]+$/.test(endpoint), 'Only a local uploaded test asset may be fetched');
      const response = await fetch(base.replace(/\/api\/v1$/, '') + endpoint);
      return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
    },
    async login(username, value = password) {
      const response = await fixture.request('POST', '/auth/admin/login', { body: { username, password: value } });
      assert.equal(response.status, 200); return response.body.data;
    },
    async command(action, token = adminToken, extra = {}) {
      const current = await fixture.request('GET', '/admin/settings', { token }); assert.equal(current.status, 200);
      return fixture.request('POST', '/admin/controls/' + action, { token,
        body: { revision: current.body.data.controls.revision, operationId: crypto.randomUUID(), ...extra } });
    },
    async staff(role, permissions = [], username = role) {
      const created = await fixture.request('POST', '/admin/staff', { token: adminToken, body: { username, password, role, permissions } });
      assert.equal(created.status, 201);
      return { ...created.body.data.admin, ...(await fixture.login(username)) };
    },
    browser() {
      const browser = crypto.randomBytes(32).toString('hex');
      const expiry = Date.now() + 86400000;
      const mac = value => crypto.createHmac('sha256', environment.AUTH_OTP_SECRET).update(value).digest('hex');
      return { cookie: `kq_browser=${browser}.${expiry}.${mac(`browser:${browser}:${expiry}`)}`, csrf: mac(`csrf:${browser}`) };
    },
    async student(email = 'student@gmail.com') {
      const local = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 40) || crypto.randomBytes(8).toString('hex');
      const normalized = `${local}.${crypto.randomBytes(4).toString('hex')}@gmail.com`;
      const emailKey = `${normalized.split('@')[0].replaceAll('.', '')}@gmail.com`;
      const userId = new (require('mongoose').Types.ObjectId)();
      const raw = crypto.randomBytes(32).toString('hex');
      const browser = crypto.randomBytes(32).toString('hex');
      const expiry = Date.now() + 86400000;
      const mac = value => crypto.createHmac('sha256', environment.AUTH_OTP_SECRET).update(value).digest('hex');
      const passwordHash = require('bcryptjs').hashSync(password, 4);
      await client.db().collection('users').insertOne({ _id: userId, email: normalized, emailKey, emailVerifiedAt: new Date(), passwordHash, status: 'active', tokenVersion: 0, createdAt: new Date(), updatedAt: new Date() });
      await client.db().collection('studentsessions').insertOne({ _id: crypto.createHash('sha256').update(raw).digest('hex'), user: userId, version: 0, expiresAt: new Date(Date.now() + 3600000) });
      return { user: { id: String(userId), email: normalized }, token: {
        cookie: `kq_session=${raw}; kq_browser=${browser}.${expiry}.${mac(`browser:${browser}:${expiry}`)}`,
        csrf: mac(`csrf:${browser}`),
      } };
    },
    async recoverMemoryQuota(owner) {
      assert(/^[a-f0-9]{24}$/i.test(owner));
      const worker = spawn(process.execPath, [path.join(__dirname, 'v2QuotaRecovery.cjs')], {
        cwd: directory, env: { ...environment, TEST_V2_OWNER: owner }, stdio: 'ignore', windowsHide: true,
      });
      const code = await new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', resolve); });
      assert.equal(code, 0, 'Disposable quota recovery worker must succeed');
    },
    async reset() {
      await stopApi(); assertOwnedDatabase();
      await client.db().dropDatabase(); // Only the random database created by this fixture.
      assertOwnedDirectory();
      await fs.rm(path.join(directory, 'public'), { recursive: true, force: true });
      await fs.rm(path.join(directory, 'private'), { recursive: true, force: true });
      await startApi(); adminToken = (await fixture.login('v2-root')).token;
    },
    async restart() { await stopApi(); await startApi(); },
    close,
  };
  try {
    mongo = spawn(process.env.MONGOD_BINARY || 'mongod', ['--bind_ip', '127.0.0.1', '--port', String(port), '--replSet', 'testV2',
      '--dbpath', dbPath, '--logpath', path.join(directory, 'mongod.log')], { stdio: 'ignore', windowsHide: true });
    let spawnError; mongo.on('error', error => { spawnError = error; });
    mongoExit = new Promise(resolve => mongo.once('exit', resolve));
    const direct = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 300 });
    try {
      for (let attempt = 0; ; attempt++) {
        try { await direct.connect(); break; } catch {
          if (spawnError || mongo.exitCode !== null || attempt > 80) throw Error('Disposable v2 MongoDB failed to start');
          await sleep(100);
        }
      }
      const options = await direct.db('admin').command({ getCmdLineOpts: 1 });
      assert.equal(path.resolve(options.parsed.storage.dbPath), dbPath);
      await direct.db('admin').command({ replSetInitiate: { _id: 'testV2', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
      for (let attempt = 0; ; attempt++) {
        if ((await direct.db('admin').command({ hello: 1 })).isWritablePrimary) break;
        if (attempt > 150) throw Error('Disposable v2 primary election timed out');
        await sleep(100);
      }
    } finally { await direct.close(); }
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 }); await client.connect();
    assert.deepEqual(await client.db().listCollections({}, { nameOnly: true }).toArray(), []);
    return fixture;
  } catch (error) {
    let diagnostic = '';
    try {
      const lines = (await fs.readFile(path.join(directory, 'mongod.log'), 'utf8')).trim().split(/\r?\n/);
      diagnostic = [...lines.slice(0, 12), ...lines.filter(line => /\"s\":\"[FE]\"|exception|assertion/i.test(line)).slice(-12)].join(' | ');
    } catch {}
    await close();
    throw new Error(diagnostic ? `${error.message}: ${diagnostic}` : error.message, { cause: error });
  }
};
