const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongoose').mongo;
const { createV2Fixture } = require('./fixtures/v2Fixture.cjs');

// Ports the auth/security cases trapped in the mixed legacy api.test.js suite.
// Its unrelated voting/schedule/candidate cases remain there for their own migration.
let f;
before(async () => { f = await createV2Fixture(); }, { timeout: 60000 });
beforeEach(async () => { await f.reset(); }, { timeout: 60000 });
after(async () => { await f?.close(); });
const register = body => f.request('POST', '/auth/register', { body });

test('v2 startup seeds an explicit hashed ADMIN and restart preserves credentials and sessions', async () => {
  const root = await f.db.collection('admins').findOne({ username: 'v2-root' });
  assert.equal(root.role, 'admin'); assert.equal(root.tokenVersion, 0);
  assert(root.passwordHash !== f.password, 'Seeded password must be hashed');
  assert(await bcrypt.compare(f.password, root.passwordHash)); assert.equal(bcrypt.getRounds(root.passwordHash), 12);
  const token = f.token;
  await f.restart();
  const after = await f.db.collection('admins').findOne({ _id: root._id });
  assert(after.passwordHash === root.passwordHash, 'Startup must not overwrite the stored hash');
  assert.equal((await f.request('GET', '/auth/admin/me', { token })).status, 200);
});

test('registration returns only a safe v2 account, never hashes, JWTs or a retired voting key', async () => {
  await f.command('registration.open');
  const response = await register({ email: '  New.Student@Example.Test ', password: f.password });
  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(response.body.data), ['user']);
  assert.deepEqual(Object.keys(response.body.data.user).sort(), ['email', 'hasVotedKing', 'hasVotedQueen', 'id', 'round']);
  assert.equal(response.body.data.user.email, 'new.student@example.test');
  const stored = await f.db.collection('users').findOne({ email: 'new.student@example.test' });
  assert(await bcrypt.compare(f.password, stored.passwordHash)); assert.equal(bcrypt.getRounds(stored.passwordHash), 12);
  assert.equal(stored.tokenVersion, 0); assert.equal(stored.status, 'active');
  assert.equal(stored.credentialIssued, undefined);
});

test('email-only registration rejects missing, malformed, short, excessive-byte and injected credentials', async () => {
  await f.command('registration.open');
  const invalid = [null, {}, { email: 'a@example.test' }, { password: f.password }, { email: 'not-email', password: f.password },
    { email: {}, password: f.password }, { email: 'a@example.test', password: 'short' }, { email: 'a@example.test', password: 'x'.repeat(73) },
    { email: 'a@example.test', password: '😀'.repeat(19) }, { email: 'a@example.test', password: f.password, role: 'admin' },
    { email: 'a@example.test', password: f.password, permissions: ['votes.read'] },
    { email: 'a@example.test', password: f.password, passwordHash: 'injected' },
    { email: 'a@example.test', password: f.password, tokenVersion: 0 }];
  // Unique invalid addresses avoid testing the rate limiter instead of validation.
  for (let i = 0; i < invalid.length; i++) {
    const body = invalid[i]; if (body?.email === 'a@example.test') body.email = `invalid-${i}@example.test`;
    assert.equal((await register(body)).status, 400);
  }
  assert.equal(await f.db.collection('users').countDocuments({}), 0);
});

test('registration accepts the bcrypt 72-byte boundary and existing accounts can login while registration is closed', async () => {
  await f.command('registration.open');
  const password = '😀'.repeat(18);
  assert.equal((await register({ email: 'boundary@example.test', password })).status, 201);
  await f.command('registration.close');
  assert.equal((await register({ email: 'closed@example.test', password: f.password })).status, 403);
  assert.equal((await f.request('POST', '/auth/login', { body: { email: 'boundary@example.test', password } })).status, 200);
});

test('normalized email uniqueness holds for sequential and concurrent registration', async () => {
  await f.command('registration.open');
  const email = 'unique@example.test';
  const results = await Promise.all([register({ email, password: f.password }), register({ email: ' UNIQUE@example.test ', password: f.password })]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal((await register({ email: 'Unique@example.test', password: f.password })).status, 409);
  assert.equal(await f.db.collection('users').countDocuments({ email }), 1);
});

test('registration rolls back the user if the shared controls transaction cannot persist', async () => {
  await f.command('registration.open');
  // Force a definite database write failure only in this fixture's random database.
  await f.db.command({ collMod: 'eventcontrols', validator: { fixtureMustNotExist: { $exists: true } }, validationLevel: 'strict' });
  try {
    assert.equal((await register({ email: 'rollback@example.test', password: f.password })).status, 500);
    assert.equal(await f.db.collection('users').countDocuments({ email: 'rollback@example.test' }), 0);
  } finally { await f.db.command({ collMod: 'eventcontrols', validator: {}, validationLevel: 'strict' }); }
});

test('student login returns HS256 account-kind and token-version claims, and a safe /me response', async () => {
  const student = await f.student();
  const claims = jwt.verify(student.token, f.secret, { algorithms: ['HS256'] });
  assert.equal(claims.role, 'user'); assert.equal(claims.v, 0); assert.equal(claims.userId, student.user.id);
  assert.equal(claims.adminId, undefined); assert.equal(claims.permissions, undefined);
  const me = await f.request('GET', '/auth/me', { token: student.token });
  assert.equal(me.status, 200); assert.deepEqual(me.body.data.user, student.user);
  assert.equal(Object.hasOwn(me.body.data.user, 'passwordHash'), false);
});

test('wrong or unknown credentials, malformed login input and client-selected roles cannot authenticate', async () => {
  await f.student();
  for (const body of [{ email: 'student@example.test', password: 'wrong' }, { email: 'missing@example.test', password: f.password },
    { email: 'student@example.test', password: 'x'.repeat(73) }]) assert.equal((await f.request('POST', '/auth/login', { body })).status, 401);
  for (const body of [{ email: 'bad', password: f.password }, { email: 'student@example.test', password: f.password, role: 'admin' },
    { email: 'student@example.test', password: f.password, userId: new ObjectId().toString() }]) assert.equal((await f.request('POST', '/auth/login', { body })).status, 400);
  assert.equal((await f.request('POST', '/auth/admin/login', { body: { username: 'v2-root', password: 'wrong' } })).status, 401);
  assert.equal((await f.request('POST', '/auth/admin/login', { body: { username: 'v2-root', password: f.password, role: 'admin' } })).status, 400);
});

test('Bearer syntax, expired/tampered/unsigned/wrong-algorithm JWTs and cookie-only sessions are rejected', async () => {
  const student = await f.student();
  const payload = { userId: student.user.id, role: 'user', v: 0 };
  const invalidTokens = [jwt.sign(payload, f.secret, { expiresIn: -1 }), jwt.sign(payload, crypto.randomBytes(48).toString('hex')),
    jwt.sign(payload, null, { algorithm: 'none' }), jwt.sign(payload, f.secret, { algorithm: 'HS384' }), 'invalid'];
  for (const token of invalidTokens) assert.equal((await f.request('GET', '/auth/me', { token })).status, 401);
  for (const authorization of ['', 'Basic value', 'Bearer', 'Bearer a b', 'bearer value']) {
    assert.equal((await f.request('GET', '/auth/me', { headers: { Authorization: authorization } })).status, 401);
  }
  assert.equal((await f.request('GET', '/auth/me', { headers: { Cookie: `token=${student.token}` } })).status, 401);
});

test('legacy/malformed identity claims fail closed without database query injection or server errors', async () => {
  const student = await f.student();
  const payloads = [{ userId: student.user.id, role: 'user' }, { userId: student.user.id, role: 'user', v: 0.5 },
    { userId: { $ne: null }, role: 'user', v: 0 }, { userId: 'bad-id', role: 'user', v: 0 },
    { userId: student.user.id, role: 'ADMIN', v: 0 }, { userId: new ObjectId().toString(), role: 'user', v: 0 }];
  for (const payload of payloads) assert.equal((await f.request('GET', '/auth/me', { token: jwt.sign(payload, f.secret) })).status, 401);
});

test('disabled and deleted students cannot keep using existing JWTs', async () => {
  const student = await f.student(); const filter = { _id: new ObjectId(student.user.id) };
  await f.db.collection('users').updateOne(filter, { $set: { status: 'disabled' } });
  assert.equal((await f.request('GET', '/auth/me', { token: student.token })).status, 403);
  assert.equal((await f.request('POST', '/auth/login', { body: { email: student.user.email, password: f.password } })).status, 403);
  await f.db.collection('users').deleteOne(filter);
  assert.equal((await f.request('GET', '/auth/me', { token: student.token })).status, 401);
});

test('student token-version changes invalidate stale sessions without trusting a client-supplied version', async () => {
  const student = await f.student();
  await f.db.collection('users').updateOne({ _id: new ObjectId(student.user.id) }, { $inc: { tokenVersion: 1 } });
  assert.equal((await f.request('GET', '/auth/me', { token: student.token, headers: { 'X-Token-Version': '1' } })).status, 401);
  const login = await f.request('POST', '/auth/login', { body: { email: student.user.email, password: f.password } });
  assert.equal(login.status, 200); assert.equal(jwt.verify(login.body.data.token, f.secret).v, 1);
});

test('student and admin sessions cannot be substituted on each other\'s protected routes', async () => {
  const student = await f.student();
  for (const endpoint of ['/auth/admin/me', '/admin/staff', '/admin/settings', '/admin/memory-photos']) {
    assert.equal((await f.request('GET', endpoint, { token: student.token, headers: { 'X-Role': 'admin' } })).status, 401);
  }
  for (const endpoint of ['/auth/me', '/voting/my-votes', '/lantern-voting/mine', '/memory-photos/mine']) {
    assert.equal((await f.request('GET', endpoint, { token: f.token })).status, 401);
  }
});

test('login rate limiting applies per account without preventing another account from authenticating', async () => {
  for (let i = 0; i < 15; i++) assert.equal((await f.request('POST', '/auth/admin/login', { body: { username: 'missing', password: f.password } })).status, 401);
  const blocked = await f.request('POST', '/auth/admin/login', { body: { username: 'missing', password: f.password } });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '60');
  await f.login('v2-root');
});

test('v2 startup refuses legacy database roles rather than silently promoting or migrating them', async () => {
  const root = await f.db.collection('admins').findOne({ username: 'v2-root' });
  await f.db.collection('admins').insertOne({ username: 'legacy-admin', role: 'ADMIN', passwordHash: root.passwordHash, status: 'active' });
  await assert.rejects(f.restart(), /Legacy test database detected/);
  assert.equal((await f.db.collection('admins').findOne({ username: 'legacy-admin' })).role, 'ADMIN');
});
