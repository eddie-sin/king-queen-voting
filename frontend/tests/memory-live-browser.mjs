/* Real React -> Vite proxy -> Express -> disposable MongoDB/local private files.
 * Never loads config.env; no HAR/trace/body/header capture (credentials stay in memory).
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const mongoose = require('mongoose');
const temp = await mkdtemp(path.join(os.tmpdir(), 'memory-live-'));
const evidence = path.resolve('test-artifacts/memory-live');
await mkdir(evidence, { recursive: true });
const report = { branch: 'eddie/manual-voting-controls', mode: 'real-local-v2', assertions: 0, steps: [], requests: [], consoleErrors: [], pageErrors: [], awsCalls: 0, cleanup: {} };
let mongo, mongoExit, backend, vite, browser, adminToken, base;
const password = crypto.randomBytes(20).toString('hex');
const adminName = `live-admin-${crypto.randomUUID()}`, moderatorName = `live-reviewer-${crypto.randomUUID()}`;
const email = `memory${crypto.randomBytes(8).toString('hex')}@gmail.com`;
const check = (value, message) => { assert(value, message); report.assertions++; };
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); report.assertions++; };
const step = text => { report.steps.push({ step: text, status: 'PASS' }); console.log(`PASS: ${text}`); };
async function api(method, endpoint, token, body, expected = 200) {
  const studentSession = token && typeof token === 'object';
  const response = await fetch(base + '/api/v1' + endpoint, { method,
    headers: { ...(typeof token === 'string' ? { Authorization: `Bearer ${token}` } : {}),
      ...(studentSession ? { Cookie: token.cookie, Origin: process.env.AUTH_ORIGIN, 'X-CSRF-Token': token.csrf } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  report.requests.push({ source: 'setup/moderation/check', method, path: endpoint, status: response.status });
  equal(response.status, expected, `${method} ${endpoint} returned unexpected status`);
  if (response.headers.get('content-type')?.startsWith('image/')) return { response, bytes: Buffer.from(await response.arrayBuffer()) };
  return { response, data: await response.json() };
}
async function command(action, token = adminToken) {
  const settings = await api('GET', '/admin/settings', token);
  return api('POST', `/admin/controls/${action}`, token, {
    revision: settings.data.data.controls.revision, operationId: crypto.randomUUID(),
  });
}
try {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.AUTH_ORIGIN = 'http://localhost:5173';
  process.env.AUTH_OTP_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.AUTH_MAIL_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.GOOGLE_CLIENT_ID_DEVELOPMENT = 'memory-live.apps.googleusercontent.com';
  process.env.RESEND_API_KEY = 'fixture-not-used';
  process.env.ADMIN_USERNAME = adminName; process.env.ADMIN_PASSWORD = password;
  process.env.MEMORY_PHOTO_STORAGE = 'local';
  process.env.MEMORY_PHOTO_UPLOAD_DIR = path.join(temp, 'private');
  process.env.LOCAL_UPLOAD_DIR = path.join(temp, 'public');
  process.env.AWS_EC2_METADATA_DISABLED = 'true';
  const dbPath = path.join(temp, 'mongo'); await mkdir(dbPath);
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  mongo = spawn(process.env.MONGOD_BINARY || 'mongod', ['--bind_ip', '127.0.0.1', '--port', String(port), '--replSet', 'memoryLiveV2', '--dbpath', dbPath, '--logpath', path.join(dbPath, 'mongod.log')], { stdio: 'ignore', windowsHide: true });
  let spawnError; mongo.on('error', error => { spawnError = error; }); mongoExit = once(mongo, 'exit');
  const direct = new mongoose.mongo.MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 300 });
  for (let i = 0; ; i++) {
    try { await direct.connect(); break; }
    catch { if (spawnError || mongo.exitCode !== null || i > 50) throw Error('Disposable local MongoDB failed to start.'); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  await direct.db('admin').command({ replSetInitiate: { _id: 'memoryLiveV2', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
  for (let i = 0; ; i++) {
    if ((await direct.db('admin').command({ hello: 1 })).isWritablePrimary) break;
    if (i > 150) throw Error('Disposable replica set did not become writable.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await direct.close();
  const database = `test_v2_${crypto.randomBytes(6).toString('hex')}`;
  const uri = `mongodb://127.0.0.1:${port}/${database}?replicaSet=memoryLiveV2`;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
  check(mongoose.connection.host === '127.0.0.1' && mongoose.connection.name === database, 'Unsafe database connection');
  // Fail closed if any image path attempts S3, before an SDK client can be built.
  const s3 = require('../../utils/s3');
  for (const name of ['uploadImage', 'deleteImage', 'uploadPrivateMemoryPhoto', 'getPrivateMemoryPhoto', 'deletePrivateMemoryPhoto']) {
    s3[name] = () => { report.awsCalls++; throw Error('AWS forbidden in this test'); };
  }
  const { seed } = require('../../utils/seed'); await seed();
  process.env.GOOGLE_CLIENT_ID_DEVELOPMENT = ''; // Keep this isolated browser run offline after startup validation.
  const Photo = require('../../model/memoryPhotosModel');
  const Quota = require('../../model/memoryPhotoQuotasModel');
  const Like = require('../../model/memoryPhotoLikesModel');
  const { Mail } = require('../../model/studentAuthModels');
  const authSecurity = require('../../utils/accounts/security');
  await Promise.all([Photo.init(), Quota.init(), Like.init()]);
  const app = require('../../app'); backend = app.listen(0, '127.0.0.1'); await once(backend, 'listening');
  base = `http://127.0.0.1:${backend.address().port}`;
  process.env.VOTING_API_TARGET = base; // Vite must not consult config.env.
  vite = await createServer({ configFile: 'vite.config.js', server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
  const front = `http://127.0.0.1:${vite.httpServer.address().port}`;
  process.env.AUTH_ORIGIN = front;
  const adminLogin = await api('POST', '/auth/admin/login', null, { username: adminName, password }); adminToken = adminLogin.data.data.token;
  await api('POST', '/admin/staff', adminToken, { username: moderatorName, password, role: 'memory_admin', permissions: ['memory.approve', 'memory.reject'] }, 201);
  const moderatorLogin = await api('POST', '/auth/admin/login', null, { username: moderatorName, password }); const moderator = moderatorLogin.data.data.token;
  equal(moderatorLogin.data.data.admin.role, 'memory_admin');
  const controls = await api('GET', '/admin/settings', moderator);
  await api('POST', '/admin/controls/memory.open', moderator, { revision: controls.data.data.controls.revision, operationId: crypto.randomUUID() }, 403);
  await command('registration.open'); await command('memory.open');
  step('Isolated MongoDB, generated full admin, Memory Admin provisioning/login and feature enable');

  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      report.externalRequestBlocked = true; return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  function monitor(page) {
    page.on('pageerror', error => report.pageErrors.push(error.name));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push(event.text().replace(/http[^\s]+/g, '[local URL]')); });
    page.on('response', response => { const u = new URL(response.url()); if (u.pathname.startsWith('/api/')) report.requests.push({ source: 'React', method: response.request().method(), path: u.pathname.replace('/api/v1', ''), status: response.status() }); });
  }
  monitor(page);
  await page.goto(front + '/#account');
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Register', exact: true }).click();
  await dialog.getByLabel('Gmail address', { exact: true }).fill(email); await dialog.getByLabel('Create password', { exact: true }).fill(password);
  const registration = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/register');
  await dialog.locator('form').getByRole('button', { name: 'Send verification code', exact: true }).click();
  const registrationResponse = await registration; equal(registrationResponse.status(), 200);
  const registrationData = (await registrationResponse.json()).data;
  const mail = await Mail.findById(registrationData.flowId).select('+payload').lean();
  const code = authSecurity.unseal(mail.payload).text.match(/code is (\d{6})/)[1];
  await dialog.getByLabel('6-digit email code').fill(code);
  await dialog.locator('form').getByRole('button', { name: 'Verify code', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  const authConfig = await page.evaluate(() => fetch('/api/v1/auth/config', { credentials: 'same-origin' }).then(response => response.json()));
  const cookies = await context.cookies(base);
  const student = { cookie: cookies.map(item => `${item.name}=${item.value}`).join('; '), csrf: authConfig.data.csrfToken };
  check(cookies.some(item => item.name.endsWith('kq_session')), 'Student login did not issue an HttpOnly session cookie');
  equal(await page.evaluate(() => localStorage.getItem('thadingyut_voter_session')), null);
  step('Real React verified-Gmail registration and cookie-session login');

  const png = await readFile('../postman/fixtures/memory-photo.png');
  async function upload(name, expectedCount) {
    await page.goto(front + '/#memory-upload');
    await page.getByText(`Limit: 3 · Accepted: ${expectedCount - 1} · Remaining: ${4 - expectedCount}`).waitFor();
    await page.locator('input[type=file][multiple]').setInputFiles({ name, mimeType: 'image/png', buffer: png });
    const submission = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/memory-photos' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Submit memories' }).click(); const response = await submission;
    equal(response.status(), 201); const photo = (await response.json()).data.photo;
    equal(photo.status, 'PENDING'); equal(Object.keys(photo).sort(), ['createdAt', 'id', 'status']);
    await page.getByText(`Limit: 3 · Accepted: ${expectedCount} · Remaining: ${3 - expectedCount}`).waitFor();
    await page.locator('.mp-submitted .mp-envelope').waitFor(); return photo;
  }
  const approved = await upload('memory-approved.png', 1);
  await page.getByRole('link', { name: 'View My Memories and current allowance →' }).click();
  await page.waitForURL('**/#my-memories'); await page.locator('.mp-quota').waitFor();
  await page.getByText('Pending review', { exact: true }).waitFor();
  equal(await page.locator('.mp-quota dd').allTextContents(), ['3', '1', '2']);
  equal(await page.locator('.mp-envelope img').count(), 0);
  await page.screenshot({ path: path.join(evidence, 'desktop-pending.png'), fullPage: true });
  await api('GET', `/memory-photos/${approved.id}/image`, null, null, 404);
  await api('GET', `/memory-photos/${approved.id}/image`, student, null, 404);
  const pending = await api('GET', '/admin/memory-photos', moderator); check(pending.data.data.photos.some(photo => photo.id === approved.id), 'Moderator list missing pending photo');
  const reviewImage = await api('GET', `/admin/memory-photos/${approved.id}/image`, moderator);
  equal(reviewImage.bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await api('GET', `/admin/memory-photos/${approved.id}/image`, student, null, 401);
  step('Real UI PNG upload, PENDING envelope/quota, private image and moderator retrieval');

  await api('PATCH', `/admin/memory-photos/${approved.id}/review`, moderator, { status: 'APPROVED' });
  await page.getByRole('button', { name: 'Refresh my memories' }).click();
  await page.getByText('Approved · opened & shared', { exact: true }).waitFor();
  await page.locator('.mp-photo-open img').evaluate(image => image.decode());
  equal(await page.locator('.mp-quota dd').allTextContents(), ['3', '1', '2']);
  step('Memory Admin approval and refreshed My Memories approved image');

  await page.goto(front + '/#memory-gallery');
  const like = page.getByRole('button', { name: 'Like memory · 0 likes', exact: true }); await like.waitFor();
  const image = page.locator('.mp-print .mp-photo-open img'); await image.evaluate(image => image.decode());
  check((await image.getAttribute('src')).endsWith(`/api/v1/memory-photos/${approved.id}/image`), 'Gallery image bypassed Express');
  await like.focus(); await page.keyboard.press('Enter'); await page.getByRole('button', { name: 'Unlike memory · 1 likes', exact: true }).waitFor();
  await page.reload(); await page.getByRole('button', { name: 'Unlike memory · 1 likes', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Unlike memory · 1 likes', exact: true }).click(); await page.getByRole('button', { name: 'Like memory · 0 likes', exact: true }).waitFor();
  equal(await Like.countDocuments(), 0);
  const opener = page.getByRole('button', { name: 'Enlarge memory 1' }); await opener.focus(); await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); check(await opener.evaluate(element => element === document.activeElement), 'Dialog focus not restored');
  await page.screenshot({ path: path.join(evidence, 'desktop-gallery.png'), fullPage: true });
  step('Approved Express gallery image, real like/reload/unlike and keyboard viewer');

  const rejected = await upload('memory-rejected.png', 2);
  await api('PATCH', `/admin/memory-photos/${rejected.id}/review`, moderator, { status: 'REJECTED' });
  await page.goto(front + '/#my-memories'); await page.getByText('Rejected', { exact: true }).waitFor();
  equal(await page.locator('.mp-quota dd').allTextContents(), ['3', '2', '1']); equal(await page.locator('.mp-envelope img').count(), 0);
  await api('GET', `/memory-photos/${rejected.id}/image`, null, null, 404);
  await api('GET', `/memory-photos/${rejected.id}/image`, student, null, 404);
  const gallery = await api('GET', '/memory-photos'); equal(gallery.data.data.photos.map(photo => photo.id), [approved.id]);
  const stored = await Photo.findById(rejected.id).lean(); check(stored.imageKey.startsWith('memory-photos/'), 'Unexpected private key');
  const staticAttempt = await fetch(base + '/uploads/' + stored.imageKey);
  report.requests.push({ source: 'privacy check', method: 'GET', path: '/uploads/[test-image]', status: staticAttempt.status });
  equal(staticAttempt.status, 404);
  equal(await readFile(path.join(process.env.MEMORY_PHOTO_UPLOAD_DIR, stored.imageKey)), png);
  step('Rejected envelope retains lifetime quota; rejected image stays private');

  for (const width of [390, 320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    for (const hash of ['#memory-gallery', '#my-memories', '#memory-upload']) {
      await page.goto(front + '/' + hash);
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
      if (hash === '#memory-gallery') await page.getByRole('button', { name: 'Like memory · 0 likes', exact: true }).waitFor();
      if (hash === '#my-memories') await page.getByText('Rejected', { exact: true }).waitFor();
      if (hash === '#memory-upload') await page.getByText('Limit: 3 · Accepted: 2 · Remaining: 1').waitFor();
      if (hash === '#memory-upload') {
        check(!(await page.locator('.mp-demo-note').textContent()).includes('no real uploads'), 'Connected upload mislabeled as demo');
        check(!(await page.locator('.mp-footer').textContent()).includes('Demo content only'), 'Connected upload footer mislabeled as demo');
      }
      if (hash === '#my-memories' && [768, 1024].includes(width)) {
        const positions = await page.locator('.mp-my-grid > article').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().top));
        check(Math.abs(positions[0] - positions[1]) < 80, 'Two-card tablet history has an empty grid column');
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width} ${hash}`);
      check(await page.locator('.mp-demo img').evaluateAll(images => images.every(image => image.hasAttribute('alt'))), 'Image missing alt attribute');
      check(await page.locator('.mp-footer').evaluate(element => !element.textContent.includes('\ufffd')), 'Malformed footer');
      if (width === 390 || width === 768) await page.screenshot({ path: path.join(evidence, `${width === 390 ? 'mobile' : 'tablet'}-${hash.slice(1)}.png`), fullPage: true });
    }
  }
  step('Desktop, 390px/320px layouts, image alternatives and reduced-motion context');

  await page.goto(front + '/#memory-gallery'); await page.getByRole('button', { name: 'Like memory · 0 likes', exact: true }).waitFor();
  await context.setOffline(true); await page.getByRole('button', { name: 'Refresh gallery', exact: true }).click();
  await page.getByText('Our memories need a moment.').waitFor(); equal(await page.locator('.mp-print').count(), 0);
  await context.setOffline(false); await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('button', { name: 'Like memory · 0 likes', exact: true }).waitFor();
  step('Real browser offline failure and online retry without demo fallback');

  await command('memory.close');
  await page.getByRole('button', { name: 'Refresh gallery', exact: true }).click(); await page.getByText('Our keepsake is resting.').waitFor();
  equal(await page.locator('.mp-print').count(), 0);
  await page.goto(front + '/#my-memories'); await page.getByText('Our keepsake is resting.').waitFor();
  await page.goto(front + '/#memory-upload'); await page.getByText('Memory Photo is currently disabled by the organisers.').waitFor();
  check(await page.getByRole('button', { name: 'Submit memories' }).isDisabled(), 'Disabled upload is interactive');
  await api('GET', `/memory-photos/${approved.id}/image`, null, null, 403);
  await command('memory.open');
  await page.goto(front + '/#account'); await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
  equal(await page.evaluate(() => localStorage.getItem('thadingyut_voter_session')), null);
  await page.goto(front + '/#memory-gallery'); await page.getByRole('button', { name: 'Sign in to like memory · 0 likes', exact: true }).waitFor();
  await page.locator('.mp-print img').evaluate(image => image.decode());
  await page.getByRole('button', { name: 'Sign in to like memory · 0 likes', exact: true }).click(); await page.waitForURL('**/#account');
  step('Disabled feature across gallery/history/upload/images, real logout and anonymous gallery/login link');
  equal(report.pageErrors, []); equal(report.awsCalls, 0); check(!report.externalRequestBlocked, 'Unexpected external request was blocked');
  check(report.consoleErrors.every(message => /^Failed to load resource:/.test(message)), 'Unexpected console error');
  step('No JavaScript exceptions, no unexpected console errors and no AWS calls');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  // Assertion messages are authored above; never serialize request payloads or browser storage.
  report.failure = error.message.replace(/http[^\s]+/g, '[local URL]');
  console.log(`FAIL: ${report.failure}`); process.exitCode = 1;
} finally {
  if (base && adminToken) {
    try { await command('memory.close'); report.cleanup.featureDisabled = true; } catch { report.cleanup.featureDisabled = false; }
  }
  await browser?.close(); await vite?.close();
  if (backend) await new Promise(resolve => backend.close(resolve));
  await mongoose.disconnect();
  if (mongo?.pid && mongo.exitCode === null) { mongo.kill('SIGTERM'); await mongoExit; }
  // Only the exact directory returned by mkdtemp belongs to this test.
  check(path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('memory-live-'), 'Unsafe cleanup path');
  await rm(temp, { recursive: true, force: true }); report.cleanup.temporaryDatabaseAndFilesRemoved = true;
  report.cleanup.serversStopped = true;
  report.requestSummary = { total: report.requests.length, successes: report.requests.filter(request => request.status < 400).length, expectedErrorResponses: report.requests.filter(request => request.status >= 400).length };
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, assertions: report.assertions, steps: report.steps.length, requests: report.requestSummary, cleanup: report.cleanup, evidence }, null, 2));
}
// Express/Mongoose dependencies may retain diagnostic handles after every owned
// service has been closed. This standalone runner has completed all awaited
// cleanup above, so terminate with the recorded test result.
process.exit(process.exitCode || 0);
