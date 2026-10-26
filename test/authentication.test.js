const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ObjectId } = require('mongoose').Types;
const { createV2Fixture } = require('./fixtures/v2Fixture.cjs');

let fixture;
before(async () => { fixture = await createV2Fixture(); }, { timeout: 60000 });
beforeEach(async () => { await fixture.reset(); }, { timeout: 60000 });
after(async () => { await fixture?.close(); }, { timeout: 30000 });

test('startup seeds the explicit ADMIN with a hashed password and valid staff session', async () => {
  const stored = await fixture.db.collection('admins').findOne({ username: 'v2-root' });
  assert.equal(stored.role, 'admin'); assert.equal(stored.status, 'active');
  assert.match(stored.passwordHash, /^\$2[aby]\$/); assert.equal(stored.passwordHash.includes(fixture.password), false);
  assert.equal((await fixture.request('GET', '/auth/admin/me', { token: fixture.token })).status, 200);
});

test('verified students authenticate only with server-issued cookie sessions', async () => {
  const student = await fixture.student('cookie-auth@gmail.com');
  const me = await fixture.request('GET', '/auth/me', { token: student.token });
  assert.equal(me.status, 200); assert.equal(me.body.data.user.id, student.user.id);
  assert.equal(me.body.data.user.role, undefined); assert.equal(me.body.data.user.permissions, undefined);
  assert.equal((await fixture.request('GET', '/auth/me')).status, 401);
  const retiredJwt = require('jsonwebtoken').sign({ userId: student.user.id, role: 'user', v: 0 }, fixture.secret, { expiresIn: '1h' });
  assert.equal((await fixture.request('GET', '/auth/me', { token: retiredJwt })).status, 401);
});

test('student mutations require same-origin CSRF and never accept client roles', async () => {
  assert.equal((await fixture.command('registration.open')).status, 200);
  const base = { email: 'no-roles@gmail.com', password: fixture.password, operationId: crypto.randomUUID() };
  assert.equal((await fixture.request('POST', '/auth/register/start', { token: fixture.browser(), body: { ...base, role: 'admin' } })).status, 400);
  assert.equal((await fixture.request('POST', '/auth/register/start', { body: base })).status, 403);
  const student = await fixture.student('csrf-check@gmail.com');
  assert.equal((await fixture.request('POST', '/wishes', { token: { cookie: student.token.cookie, csrf: '0'.repeat(64) }, body: { message: 'blocked' } })).status, 403);
});

test('disabled or deleted students immediately lose existing sessions', async () => {
  const student = await fixture.student('disabled@gmail.com');
  await fixture.db.collection('users').updateOne({ _id: new ObjectId(student.user.id) }, { $set: { status: 'disabled' } });
  assert.equal((await fixture.request('GET', '/auth/me', { token: student.token })).status, 401);
  await fixture.db.collection('users').deleteOne({ _id: new ObjectId(student.user.id) });
  assert.equal((await fixture.request('GET', '/auth/me', { token: student.token })).status, 401);
});

test('student and staff sessions cannot substitute across account kinds', async () => {
  const student = await fixture.student('kind-isolation@gmail.com');
  assert.equal((await fixture.request('GET', '/admin/settings', { token: student.token })).status, 401);
  assert.equal((await fixture.request('GET', '/auth/me', { token: fixture.token })).status, 401);
  assert.equal((await fixture.request('GET', '/memory-photos/mine', { token: fixture.token })).status, 401);
});
