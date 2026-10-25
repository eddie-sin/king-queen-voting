// Local manual preview only. Does not load config.env or contact AWS.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'frontend/test-artifacts/manual-preview');
const stateFile = path.join(dir, 'state.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:5502';
async function api(method, url, token, body) {
  const r = await fetch(base + '/api/v1' + url, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) throw Error(`Preview setup ${method} ${url}: HTTP ${r.status}`);
  return r.json();
}
async function main() {
  if (process.argv[2] === 'stop') {
    if (!fs.existsSync(stateFile)) throw Error('No preview state exists.');
    fs.writeFileSync(path.join(dir, 'stop.request'), 'stop');
    console.log('Stop requested. Wait for stopped.json before deleting local data.');
    return;
  }
  for (const port of [5502, 5573, 27028]) await new Promise((resolve, reject) => {
    const s = net.createServer(); s.once('error', () => reject(Error(`Port ${port} is occupied; no process was disturbed.`)));
    s.listen(port, '127.0.0.1', () => s.close(resolve));
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'mongo'), { recursive: true });
  const credentialsFile = path.join(dir, 'accounts.private.json');
  const credentials = fs.existsSync(credentialsFile) ? JSON.parse(fs.readFileSync(credentialsFile)) : {
    admin_username: `preview-admin-${crypto.randomUUID()}`, admin_password: crypto.randomBytes(24).toString('hex'),
    student_email: `preview-${crypto.randomUUID()}@example.test`, student_password: crypto.randomBytes(24).toString('hex'),
    memory_admin_username: `preview-memory-${crypto.randomUUID()}`, memory_admin_password: crypto.randomBytes(24).toString('hex'),
    jwt: crypto.randomBytes(48).toString('hex'),
  };
  fs.writeFileSync(credentialsFile, JSON.stringify(credentials), { mode: 0o600 });
  // Preload shields the existing server startup from dotenv and AWS providers.
  const preload = path.join(dir, 'local-only.cjs');
  fs.writeFileSync(preload, `require(${JSON.stringify(require.resolve('dotenv'))}).config = () => ({parsed:{}});\nconst s3=require(${JSON.stringify(path.join(root, 'utils/s3.js'))}); for(const key of Object.keys(s3)) if(typeof s3[key]==='function') s3[key]=()=>{throw Error('AWS forbidden in local preview');};\n`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(AWS_|DATABASE|JWT_|ADMIN_|MEMORY_PHOTO_|NODE_OPTIONS|VITE_)/.test(k)));
  Object.assign(env, { NODE_ENV: 'development', PORT: '5502', DATABASE_LOCAL: 'mongodb://127.0.0.1:27028/memory_manual_preview',
    JWT_SECRET: credentials.jwt, JWT_EXPIRES_IN: '12h', ADMIN_USERNAME: credentials.admin_username, ADMIN_PASSWORD: credentials.admin_password,
    MEMORY_PHOTO_STORAGE: 'local', MEMORY_PHOTO_ALLOW_SHARED_BUCKET: 'false', AWS_EC2_METADATA_DISABLED: 'true',
    MEMORY_PHOTO_UPLOAD_DIR: path.join(dir, 'private'), LOCAL_UPLOAD_DIR: path.join(dir, 'public'),
    VOTING_API_TARGET: base, NODE_OPTIONS: `--require "${preload.replaceAll('\\', '/')}"` });
  const state = { manager: process.pid, pids: [], database: 'memory_manual_preview', backend: base, frontend: 'http://127.0.0.1:5573' };
  const children = [];
  fs.rmSync(path.join(dir, 'stop.request'), {force:true});
  fs.rmSync(path.join(dir, 'stopped.json'), {force:true});
  fs.rmSync(path.join(dir, 'ready.json'), {force:true});
  let stopping = false;
  const control = setInterval(async () => {
    if (stopping) return;
    if (!fs.existsSync(path.join(dir, 'stop.request'))) return;
    stopping = true;
    for(const child of children) if(child.exitCode===null) {
      try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {stdio:'ignore', windowsHide:true}); } catch {}
    }
    await sleep(1000);
    const stopped = children.every(child => child.exitCode !== null || child.signalCode !== null);
    fs.writeFileSync(path.join(dir, 'stopped.json'), JSON.stringify({stopped}));
    if (stopped) clearInterval(control);
    stopping = false;
  }, 1000);
  function launch(exe, args, name, cwd = root) {
    const log = fs.openSync(path.join(dir, name + '.log'), 'a');
    const child = spawn(exe, args, { cwd, env, windowsHide: true, stdio: ['ignore', log, log] });
    children.push(child); state.pids.push(child.pid); fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    child.on('error', () => { console.error(`${name} could not start`); process.exitCode = 1; });
    return child;
  }
  launch(process.env.MONGOD_BINARY || 'C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe', ['--bind_ip', '127.0.0.1', '--port', '27028', '--dbpath', path.join(dir, 'mongo'), '--logpath', path.join(dir, 'mongod.log')], 'mongo');
  launch(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run dev'], 'backend');
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + '/api/v1/settings')).ok) { ready = true; break; } } catch {}
    await sleep(500);
  }
  if (!ready) { fs.writeFileSync(path.join(dir, 'stop.request'), 'stop'); throw Error('Preview backend did not become ready. See local logs.'); }
  const admin = (await api('POST', '/auth/admin/login', null, { username: credentials.admin_username, password: credentials.admin_password })).data.token;
  let student;
  try { student = (await api('POST', '/auth/login', null, { email: credentials.student_email, password: credentials.student_password })).data.token; }
  catch { await api('POST', '/auth/register', null, { email: credentials.student_email, password: credentials.student_password }); student = (await api('POST', '/auth/login', null, { email: credentials.student_email, password: credentials.student_password })).data.token; }
  let moderator;
  try { moderator = (await api('POST', '/auth/admin/login', null, { username: credentials.memory_admin_username, password: credentials.memory_admin_password })).data.token; }
  catch { await api('POST', '/admin/memory-admins', admin, { username: credentials.memory_admin_username, password: credentials.memory_admin_password }); moderator = (await api('POST', '/auth/admin/login', null, { username: credentials.memory_admin_username, password: credentials.memory_admin_password })).data.token; }
  await api('PATCH', '/admin/settings', admin, { memoryPhotosEnabled: true });
  const values = { base_url: base, ...credentials, admin_token: admin, student_token: student, memory_admin_token: moderator, photo_id: '' };
  delete values.jwt;
  const template = { name: 'Memory Photo - disposable manual preview (LOCAL ONLY)', _postman_variable_scope: 'environment', values: Object.entries(values).map(([key, value]) => ({ key, value, enabled: true, type: /password|token/.test(key) ? 'secret' : 'default' })) };
  fs.writeFileSync(path.join(dir, 'Memory-Photo.preview.private.postman_environment.json'), JSON.stringify(template, null, 2), { mode: 0o600 });
  launch(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run dev -- --port 5573 --strictPort'], 'frontend', path.join(root, 'frontend'));
  fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify({ ...state, featureEnabled: true, roles: ['STUDENT', 'ADMIN', 'MEMORY_ADMIN'], storage: 'private-local' }, null, 2));
  console.log('Isolated manual preview ready. Credentials are only in ignored local files.');
}
main().catch(() => { console.error('Manual preview setup failed; inspect local service logs without sharing secrets.'); process.exitCode = 1; });
