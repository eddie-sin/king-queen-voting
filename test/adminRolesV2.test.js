const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongoose').Types;
const Admin = require('../model/adminsModel');
const { createV2Fixture } = require('./fixtures/v2Fixture.cjs');

let fixture;
before(async () => { fixture = await createV2Fixture(); }, { timeout: 60000 });
beforeEach(async () => { await fixture.reset(); }, { timeout: 60000 });
after(async () => { await fixture?.close(); }, { timeout: 30000 });

const roles = async () => ({
  voting: await fixture.staff('voting_admin', [], 'vote-reviewer'),
  lantern: await fixture.staff('lantern_admin', [], 'lantern-reviewer'),
  memory: await fixture.staff('memory_admin', [], 'memory-reviewer'),
});

test('v2 Admin schema requires four lowercase roles and validates delegated grants', async () => {
  const hash = await bcrypt.hash(fixture.password, 12);
  for (const role of ['admin', 'voting_admin', 'lantern_admin', 'memory_admin']) {
    const account = new Admin({ username: `${role}-schema`, passwordHash: hash, role });
    await account.validate();
    assert.equal(account.status, 'active'); assert.equal(account.tokenVersion, 0); assert.deepEqual(account.permissions, []);
  }
  for (const role of [undefined, null, 'ADMIN', 'MEMORY_ADMIN', 'student', 'super_admin']) {
    await assert.rejects(new Admin({ username: 'invalid-role', passwordHash: hash, role }).validate(), { name: 'ValidationError' });
  }
  // The schema accepts globally known grants; provisioning/update controllers
  // enforce the narrower role-to-permission relationship tested below.
  await new Admin({ username: 'known-grant', passwordHash: hash, role: 'voting_admin', permissions: ['memory.open'] }).validate();
  await assert.rejects(new Admin({ username: 'unknown-grant', passwordHash: hash, role: 'voting_admin', permissions: ['admin.everything'] }).validate(), { name: 'ValidationError' });
  await assert.rejects(new Admin({ username: 'duplicate-grant', passwordHash: hash, role: 'memory_admin', permissions: ['memory.open', 'memory.open'] }).validate(), { name: 'ValidationError' });
});

test('ADMIN securely provisions every delegated role without exposing credentials', async () => {
  const accounts = await roles();
  for (const [expected, account] of Object.entries({ voting_admin: accounts.voting, lantern_admin: accounts.lantern, memory_admin: accounts.memory })) {
    assert.equal(account.role, expected);
    assert.deepEqual(Object.keys(account.admin).sort(), ['id', 'permissions', 'role', 'status', 'username']);
    const stored = await fixture.db.collection('admins').findOne({ _id: new ObjectId(account.id) });
    assert.notEqual(stored.passwordHash, fixture.password); assert.equal(bcrypt.getRounds(stored.passwordHash), 12);
    assert(await bcrypt.compare(fixture.password, stored.passwordHash));
    const claims = jwt.verify(account.token, fixture.secret, { algorithms: ['HS256'] });
    assert.equal(claims.role, 'admin'); assert.equal(claims.v, 0); assert.equal(claims.adminId, account.id);
    assert.equal(Object.hasOwn(claims, 'permissions'), false);
  }
});

test('delegated roles receive only their read surface while ADMIN retains all staff surfaces', async () => {
  const accounts = await roles();
  const matrix = [['/admin/candidates', 'voting'], ['/admin/memory-photos', 'memory'], ['/admin/vote-totals', null], ['/admin/lantern-vote-totals', null]];
  for (const [endpoint, implicitRole] of matrix) {
    assert.equal((await fixture.request('GET', endpoint, { token: fixture.token })).status, 200, `ADMIN ${endpoint}`);
    for (const [name, account] of Object.entries(accounts)) {
      assert.equal((await fixture.request('GET', endpoint, { token: account.token })).status, name === implicitRole ? 200 : 403, `${name} ${endpoint}`);
    }
  }
  for (const account of Object.values(accounts)) {
    const settings = await fixture.request('GET', '/admin/settings', { token: account.token });
    assert.equal(settings.status, 200); assert.deepEqual(Object.keys(settings.body.data), ['controls']);
  }
});

test('permissions are role-scoped, default denied, and become effective or revoked immediately', async () => {
  const accounts = await roles();
  assert.equal((await fixture.command('voting.open', accounts.voting.token)).status, 403);
  assert.equal((await fixture.command('memory.open', accounts.memory.token)).status, 403);
  assert.equal((await fixture.command('lantern.open', accounts.lantern.token)).status, 403);
  for (const [account, permissions] of [[accounts.voting, ['voting.open', 'voting.close', 'votes.read']], [accounts.memory, ['memory.open', 'memory.close']], [accounts.lantern, ['lantern.open', 'lantern.close', 'lantern.votes.read']]]) {
    assert.equal((await fixture.request('PATCH', `/admin/staff/${account.id}`, { token: fixture.token, body: { permissions } })).status, 200);
  }
  assert.equal((await fixture.command('voting.open', accounts.voting.token)).status, 200);
  assert.equal((await fixture.command('voting.close', accounts.voting.token)).status, 200);
  assert.equal((await fixture.command('memory.open', accounts.memory.token)).status, 200);
  assert.equal((await fixture.command('memory.close', accounts.memory.token)).status, 200);
  assert.equal((await fixture.command('lantern.open', accounts.lantern.token)).status, 200);
  assert.equal((await fixture.command('lantern.close', accounts.lantern.token)).status, 200);
  assert.equal((await fixture.request('GET', '/admin/vote-totals', { token: accounts.voting.token })).status, 200);
  assert.equal((await fixture.request('GET', '/admin/lantern-vote-totals', { token: accounts.lantern.token })).status, 200);
  assert.equal((await fixture.request('PATCH', `/admin/staff/${accounts.memory.id}`, { token: fixture.token, body: { permissions: [] } })).status, 200);
  assert.equal((await fixture.command('memory.open', accounts.memory.token)).status, 403);
});

test('permissions cannot cross roles and request claims or headers cannot elevate access', async () => {
  const accounts = await roles();
  for (const [id, permission] of [[accounts.voting.id, 'memory.open'], [accounts.memory.id, 'votes.read'], [accounts.lantern.id, 'voting.open']]) {
    assert.equal((await fixture.request('PATCH', `/admin/staff/${id}`, { token: fixture.token, body: { permissions: [permission] } })).status, 400);
  }
  const forged = jwt.sign({ adminId: accounts.memory.id, role: 'admin', v: 0, adminRole: 'admin', permissions: ['*', 'votes.read'] }, fixture.secret, { algorithm: 'HS256', expiresIn: '1h' });
  assert.equal((await fixture.request('GET', '/admin/vote-totals', { token: forged, headers: { 'X-Role': 'ADMIN', 'X-Permissions': '*' } })).status, 403);
  assert.equal((await fixture.request('POST', '/admin/staff', { token: forged, body: { username: 'escalated', password: fixture.password, role: 'memory_admin' } })).status, 403);
  assert.equal(await fixture.db.collection('admins').countDocuments({ username: 'escalated' }), 0);
});

test('delegated administrators cannot manage accounts, change roles, or target root ADMIN', async () => {
  const accounts = await roles();
  for (const account of Object.values(accounts)) {
    assert.equal((await fixture.request('GET', '/admin/staff', { token: account.token })).status, 403);
    assert.equal((await fixture.request('POST', '/admin/staff', { token: account.token, body: { username: 'forbidden', password: fixture.password, role: account.role } })).status, 403);
    assert.equal((await fixture.request('PATCH', `/admin/staff/${account.id}`, { token: account.token, body: { permissions: [] } })).status, 403);
  }
  assert.equal((await fixture.request('PATCH', `/admin/staff/${accounts.memory.id}`, { token: fixture.token, body: { role: 'admin' } })).status, 400);
  assert.equal((await fixture.request('POST', '/admin/staff', { token: fixture.token, body: { username: 'second-root', password: fixture.password, role: 'admin' } })).status, 400);
  const root = await fixture.login('v2-root');
  assert.equal((await fixture.request('PATCH', `/admin/staff/${root.admin.id}`, { token: fixture.token, body: { status: 'disabled' } })).status, 404);
  assert.equal((await fixture.request('DELETE', `/admin/staff/${root.admin.id}`, { token: fixture.token })).status, 404);
});

test('student registration and login cannot create staff or select privileges', async () => {
  assert.equal((await fixture.command('registration.open')).status, 200);
  for (const body of [{ email: 'rolecheck@gmail.com', password: fixture.password, operationId: crypto.randomUUID(), role: 'admin' },
    { email: 'permissioncheck@gmail.com', password: fixture.password, operationId: crypto.randomUUID(), permissions: ['memory.open'] },
    { email: 'hashcheck@gmail.com', password: fixture.password, operationId: crypto.randomUUID(), passwordHash: 'chosen' }]) {
    assert.equal((await fixture.request('POST', '/auth/register/start', { token: fixture.browser(), body })).status, 400);
  }
  const student = await fixture.student('student@gmail.com');
  assert.equal(student.user.role, undefined); assert.equal(student.user.permissions, undefined);
  assert.equal((await fixture.request('POST', '/admin/staff', { token: student.token, body: { username: 'forbidden', password: fixture.password, role: 'memory_admin' } })).status, 401);
  assert.equal((await fixture.request('POST', '/auth/admin/login', { body: { username: 'v2-root', password: fixture.password, role: 'admin' } })).status, 400);
});

test('student, ADMIN and delegated sessions cannot substitute across account kinds or roles', async () => {
  const accounts = await roles(); const student = await fixture.student('kind-check@example.test');
  for (const endpoint of ['/admin/settings', '/admin/memory-photos', '/admin/staff']) assert.equal((await fixture.request('GET', endpoint, { token: student.token })).status, 401);
  for (const token of [fixture.token, accounts.voting.token, accounts.lantern.token, accounts.memory.token]) {
    assert.equal((await fixture.request('GET', '/auth/me', { token })).status, 401);
    assert.equal((await fixture.request('GET', '/memory-photos/mine', { token })).status, 401);
  }
  assert.equal((await fixture.request('GET', '/admin/candidates', { token: accounts.memory.token })).status, 403);
  assert.equal((await fixture.request('GET', '/admin/memory-photos', { token: accounts.voting.token })).status, 403);
});

test('disable, password reset, username change and deletion invalidate delegated sessions', async () => {
  const account = await fixture.staff('memory_admin', ['memory.open'], 'session-reviewer');
  assert.equal((await fixture.request('PATCH', `/admin/staff/${account.id}`, { token: fixture.token, body: { status: 'disabled' } })).status, 200);
  assert.equal((await fixture.request('GET', '/admin/memory-photos', { token: account.token })).status, 401);
  assert.equal((await fixture.request('POST', '/auth/admin/login', { body: { username: 'session-reviewer', password: fixture.password } })).status, 403);
  assert.equal((await fixture.request('PATCH', `/admin/staff/${account.id}`, { token: fixture.token, body: { status: 'active' } })).status, 200);
  assert.equal((await fixture.request('GET', '/admin/memory-photos', { token: account.token })).status, 401);
  let current = await fixture.login('session-reviewer'); const replacement = `${fixture.password}-replacement`;
  assert.equal((await fixture.request('PATCH', `/admin/staff/${account.id}`, { token: fixture.token, body: { password: replacement } })).status, 200);
  assert.equal((await fixture.request('GET', '/admin/memory-photos', { token: current.token })).status, 401);
  current = await fixture.login('session-reviewer', replacement);
  assert.equal((await fixture.request('PATCH', `/admin/staff/${account.id}`, { token: fixture.token, body: { username: 'renamed-reviewer' } })).status, 200);
  assert.equal((await fixture.request('GET', '/admin/memory-photos', { token: current.token })).status, 401);
  current = await fixture.login('renamed-reviewer', replacement);
  assert.equal((await fixture.request('DELETE', `/admin/staff/${account.id}`, { token: fixture.token })).status, 200);
  assert.equal((await fixture.request('GET', '/admin/memory-photos', { token: current.token })).status, 401);
});

test('permission edits preserve JWT version but authorization always uses current database grants', async () => {
  const account = await fixture.staff('voting_admin', [], 'live-permissions'); const claims = jwt.verify(account.token, fixture.secret);
  assert.equal((await fixture.command('registration.open', account.token)).status, 403);
  assert.equal((await fixture.request('PATCH', `/admin/staff/${account.id}`, { token: fixture.token, body: { permissions: ['registration.open', 'registration.close'] } })).status, 200);
  assert.equal((await fixture.command('registration.open', account.token)).status, 200);
  assert.equal((await fixture.request('PATCH', `/admin/staff/${account.id}`, { token: fixture.token, body: { permissions: [] } })).status, 200);
  assert.equal((await fixture.command('registration.close', account.token)).status, 403);
  assert.equal((await fixture.db.collection('admins').findOne({ _id: new ObjectId(account.id) })).tokenVersion, claims.v);
});

test('malformed provisioning, unknown fields, invalid grants and duplicates remain rejected', async () => {
  const invalid = [{}, { username: ' ', password: fixture.password }, { username: 'x', password: 'short' }, { username: {}, password: fixture.password },
    { username: 'x', password: fixture.password, role: 'ADMIN' }, { username: 'x', password: fixture.password, role: 'student' },
    { username: 'x', password: fixture.password, role: 'memory_admin', permissions: ['votes.read'] },
    { username: 'x', password: fixture.password, role: 'memory_admin', permissions: ['memory.open', 'memory.open'] },
    { username: 'x', password: fixture.password, role: 'memory_admin', passwordHash: 'injected' },
    { username: 'x', password: fixture.password, role: 'memory_admin', tokenVersion: 99 }];
  for (const body of invalid) assert.equal((await fixture.request('POST', '/admin/staff', { token: fixture.token, body })).status, 400);
  assert.equal((await fixture.request('POST', '/admin/staff', { token: fixture.token, body: { username: 'unique-reviewer', password: fixture.password, role: 'memory_admin' } })).status, 201);
  assert.equal((await fixture.request('POST', '/admin/staff', { token: fixture.token, body: { username: 'UNIQUE-REVIEWER', password: fixture.password, role: 'memory_admin' } })).status, 409);
});

test('expired, tampered, legacy-version and deleted staff identities fail closed', async () => {
  const account = await fixture.staff('memory_admin', [], 'identity-reviewer');
  const invalid = [jwt.sign({ adminId: account.id, role: 'admin', v: 0 }, fixture.secret, { algorithm: 'HS256', expiresIn: -1 }),
    jwt.sign({ adminId: account.id, role: 'admin', v: 0 }, 'wrong-signing-key-long-enough-for-tests'),
    jwt.sign({ adminId: account.id, role: 'admin' }, fixture.secret, { algorithm: 'HS256', expiresIn: '1h' }),
    jwt.sign({ adminId: account.id, role: 'ADMIN', v: 0 }, fixture.secret, { algorithm: 'HS256', expiresIn: '1h' })];
  for (const token of invalid) assert.equal((await fixture.request('GET', '/admin/memory-photos', { token })).status, 401);
  await fixture.db.collection('admins').deleteOne({ _id: new ObjectId(account.id) });
  assert.equal((await fixture.request('GET', '/admin/memory-photos', { token: account.token })).status, 401);
});
