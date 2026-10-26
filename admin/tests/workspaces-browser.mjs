/* Real Admin React -> Express -> disposable MongoDB replica set. No AWS/config.env. */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('../../frontend/node_modules/playwright');
const jwt = require('jsonwebtoken');
const { createV2Fixture } = require('../../test/fixtures/v2Fixture.cjs');

const fixture = await createV2Fixture();
await fixture.reset();
process.env.VOTING_API_TARGET = fixture.baseUrl;
const vite = await createServer({ configFile: 'vite.config.js', server: { host: '127.0.0.1', port: 0 } });
await vite.listen();
const front = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
const password = fixture.password;
const png = await readFile('../postman/fixtures/memory-photo.png');
let assertions = 0; const steps = [];
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
const check = (value, message) => { assert(value, message); assertions++; };
const step = value => { steps.push(value); console.log(`PASS: ${value}`); };
const request = async (method, endpoint, token, body, expected = 200) => {
  const response = await fixture.request(method, endpoint, { token, body });
  equal(response.status, expected, `${method} ${endpoint}: ${JSON.stringify(response.body)}`); return response;
};
const command = async (action, token = fixture.token, expected = 200) => {
  const settings = await request('GET', '/admin/settings', token);
  return request('POST', `/admin/controls/${action}`, token,
    { revision: settings.body.data.controls.revision, operationId: crypto.randomUUID() }, expected);
};
async function login(page, username) {
  await page.getByLabel('Admin username').fill(username); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Enter admin workspace →' }).click();
  await page.getByText('Signed in to administration.').waitFor();
}
async function context(width = 1440) {
  const value = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
  const page = await value.newPage(), pageErrors = [], consoleErrors = [], failures = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', event => { if (event.type() === 'error') consoleErrors.push(event.text()); });
  page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 500) failures.push([response.status(), response.url()]); });
  await page.goto(front); return { value, page, pageErrors, consoleErrors, failures };
}
const assertHealthy = async state => {
  equal(state.pageErrors, []); equal(state.failures, []);
  check(state.consoleErrors.every(message => /^Failed to load resource:/.test(message)), 'Unexpected browser console error');
  check(await state.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Responsive horizontal overflow');
};

let voting, lantern, memory, student;
try {
  // ADMIN creates a Voting Admin through the actual workspace UI.
  const admin = await context(); await login(admin.page, 'v2-root');
  await admin.page.getByRole('heading', { name: 'Staff accounts', level: 1 }).waitFor();
  await admin.page.getByRole('button', { name: 'Create staff account' }).click();
  const editor = admin.page.getByRole('dialog');
  await editor.getByLabel('Role').selectOption('voting_admin');
  await editor.getByLabel('Username').fill('browser-voting');
  await editor.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  for (const label of ['Create candidates', 'Update candidates', 'Delete candidates', 'Open voting', 'Close voting',
    'Open announcement', 'Close announcement', 'Open registration', 'Close registration', 'View candidate vote totals (manual refresh)']) {
    await editor.getByLabel(label).check();
  }
  await editor.getByRole('button', { name: 'Save account' }).click();
  await admin.page.getByText('browser-voting', { exact: true }).waitFor();
  voting = await fixture.login('browser-voting');
  lantern = await fixture.staff('lantern_admin', ['lantern.open', 'lantern.close', 'lantern.announce', 'lantern.hide', 'lantern.votes.read'], 'browser-lantern');
  memory = await fixture.staff('memory_admin', ['memory.open', 'memory.close', 'memory.approve', 'memory.reject'], 'browser-memory');
  equal((await request('POST', '/admin/staff', fixture.token, { username: 'forbidden-root', password, role: 'admin', permissions: [] }, 400)).status, 400);
  step('ADMIN login, UI staff creation/grants and higher-admin provisioning restriction');

  // Current permissions are database-owned; revoke and restore without issuing a new JWT.
  let staffList = await request('GET', '/admin/staff', fixture.token); const votingRecord = staffList.body.data.admins.find(item => item.username === 'browser-voting');
  const withoutTotals = votingRecord.permissions.filter(item => item !== 'votes.read');
  await request('PATCH', `/admin/staff/${votingRecord.id}`, fixture.token, { permissions: withoutTotals });
  equal((await request('GET', '/admin/vote-totals', voting.token, undefined, 403)).status, 403);
  await request('PATCH', `/admin/staff/${votingRecord.id}`, fixture.token, { permissions: votingRecord.permissions });
  equal((await request('GET', '/admin/vote-totals', voting.token)).status, 200);
  step('ADMIN grant/revoke takes effect immediately on existing staff JWT');

  // Build real voting state through supported APIs.
  await command('registration.open'); student = await fixture.student('browser-student@example.test');
  const king = (await request('POST', '/candidates', voting.token, { fullName: 'Browser King', category: 'king', images: ['https://example.test/king.png'] }, 201)).body.data.candidate;
  const queen = (await request('POST', '/candidates', voting.token, { fullName: 'Browser Queen', category: 'queen', images: ['https://example.test/queen.png'] }, 201)).body.data.candidate;
  await command('voting.open', voting.token);
  const live = (await request('GET', '/settings')).body.data.controls;
  await request('POST', '/voting/submit', student.token, { candidateId: king._id, contest: 'king', round: live.round, window: live.window }, 201);
  await request('POST', '/voting/submit', student.token, { candidateId: queen._id, contest: 'queen', round: live.round, window: live.window }, 201);
  await command('voting.close', voting.token);

  const votingUi = await context(); await login(votingUi.page, 'browser-voting');
  await votingUi.page.getByText('Browser King', { exact: true }).waitFor();
  await votingUi.page.getByRole('button', { name: 'Event controls' }).focus(); await votingUi.page.keyboard.press('Enter');
  await votingUi.page.getByText('2 recorded ballots', { exact: true }).waitFor();
  await votingUi.page.getByRole('button', { name: 'Open announcement' }).click();
  await votingUi.page.getByText('Visible to students', { exact: true }).waitFor();
  equal((await request('GET', '/results')).status, 200);
  await votingUi.page.getByRole('button', { name: 'Close announcement' }).click();
  await votingUi.page.getByRole('button', { name: 'Open voting' }).click();
  await votingUi.page.getByText('Open', { exact: true }).first().waitFor();
  await votingUi.page.getByRole('button', { name: 'Close voting' }).click();
  await votingUi.page.getByText('Closed', { exact: true }).first().waitFor();
  equal((await request('POST', '/admin/controls/memory.open', voting.token,
    { revision: (await request('GET', '/admin/settings', voting.token)).body.data.controls.revision, operationId: crypto.randomUUID() }, 403)).status, 403);
  await votingUi.page.setViewportSize({ width: 320, height: 760 }); await assertHealthy(votingUi); await votingUi.value.close();
  step('VOTING_ADMIN candidate view, manual controls, announcement/results, private totals and unrelated-feature denial');

  // Confirm omitted counts render as unavailable, never zero/undefined.
  await request('PATCH', `/admin/staff/${votingRecord.id}`, fixture.token, { permissions: withoutTotals });
  const noTotals = await context(); await login(noTotals.page, 'browser-voting');
  await noTotals.page.getByRole('button', { name: 'Event controls' }).click();
  await noTotals.page.getByText('Private ballot total unavailable', { exact: true }).waitFor();
  equal(await noTotals.page.getByText(/0 recorded ballots|undefined recorded ballots/).count(), 0);
  await assertHealthy(noTotals); await noTotals.value.close();
  await request('PATCH', `/admin/staff/${votingRecord.id}`, fixture.token, { permissions: votingRecord.permissions });
  step('Omitted private ballotCount is represented as unavailable, never fabricated as zero/undefined');

  // Lantern UI uses real image storage and votes.
  const lanternForm = new FormData(); lanternForm.append('section', 'lantern'); lanternForm.append('title', 'Browser Lantern'); lanternForm.append('description', 'A test light');
  lanternForm.append('images', new Blob([png], { type: 'image/png' }), 'lantern.png');
  const lanternImage = (await request('POST', '/images', lantern.token, lanternForm, 201)).body.data.images[0];
  const lanternUi = await context(); await login(lanternUi.page, 'browser-lantern');
  await lanternUi.page.getByText('Browser Lantern', { exact: true }).waitFor();
  await lanternUi.page.getByRole('button', { name: 'Open', exact: true }).click();
  await lanternUi.page.locator('.control-card').filter({ hasText: 'Lantern voting' }).locator('strong').getByText('Open', { exact: true }).waitFor();
  const lanternState = (await request('GET', '/lantern-voting')).body.data;
  await request('POST', '/lantern-voting', student.token, { lanternId: lanternImage._id, window: lanternState.window });
  await lanternUi.page.getByRole('button', { name: 'Close', exact: true }).click();
  await lanternUi.page.locator('.control-card').filter({ hasText: 'Lantern voting' }).locator('strong').getByText('Closed', { exact: true }).waitFor();
  await lanternUi.page.getByRole('button', { name: 'Announce winner' }).click();
  await lanternUi.page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Hide announcement')?.disabled);
  await lanternUi.page.getByRole('button', { name: 'Refresh totals' }).click(); await lanternUi.page.getByText('1', { exact: true }).waitFor();
  equal((await request('POST', '/candidates', lantern.token, { fullName: 'No', category: 'king', images: ['https://example.test/no.png'] }, 403)).status, 403);
  equal((await request('GET', '/admin/memory-photos', lantern.token, undefined, 403)).status, 403);
  equal(Object.hasOwn((await request('GET', '/admin/settings', lantern.token)).body.data, 'ballotCount'), false);
  await lanternUi.page.setViewportSize({ width: 320, height: 760 }); await assertHealthy(lanternUi); await lanternUi.value.close();
  step('LANTERN_ADMIN content, voting, winner, totals and cross-role restrictions');

  // Memory moderation history remains all-status and terminal after review.
  const memoryUi = await context(); await login(memoryUi.page, 'browser-memory');
  await memoryUi.page.getByRole('button', { name: 'Open', exact: true }).click();
  await memoryUi.page.locator('.control-card').filter({ hasText: 'Memory feature' }).locator('strong').getByText('Open', { exact: true }).waitFor();
  async function uploadMemory(name) {
    const form = new FormData(); form.append('images', new Blob([png], { type: 'image/png' }), name);
    return (await request('POST', '/memory-photos', student.token, form, 201)).body.data.photo;
  }
  await uploadMemory('approved.png'); await uploadMemory('rejected.png'); await uploadMemory('pending.png');
  await memoryUi.page.getByRole('button', { name: 'Refresh photos' }).click();
  const pendingCards = memoryUi.page.locator('.memory-review-card').filter({ hasText: 'PENDING' }); await pendingCards.first().waitFor();
  await pendingCards.nth(0).getByRole('button', { name: 'Approve photo' }).click();
  await memoryUi.page.getByText('Photo approved for the public gallery.').waitFor();
  const remaining = memoryUi.page.locator('.memory-review-card').filter({ hasText: 'PENDING' });
  await remaining.first().getByRole('button', { name: 'Reject photo' }).click();
  await memoryUi.page.getByText('Photo rejected.').waitFor();
  await memoryUi.page.getByRole('button', { name: 'Refresh photos' }).click();
  await memoryUi.page.waitForFunction(() => document.querySelectorAll('.memory-review-card').length === 3);
  equal(await memoryUi.page.locator('.memory-review-card').count(), 3);
  for (const status of ['APPROVED', 'REJECTED']) {
    const card = memoryUi.page.locator('.memory-review-card').filter({ hasText: status });
    check(await card.getByRole('button', { name: 'Approve photo' }).isDisabled(), `${status} photo could be approved again`);
    check(await card.getByRole('button', { name: 'Reject photo' }).isDisabled(), `${status} photo could be rejected again`);
  }
  const moderationHistory = (await request('GET', '/admin/memory-photos', memory.token)).body.data.photos;
  const reviewedPhoto = moderationHistory.find(photo => photo.status === 'APPROVED');
  check(reviewedPhoto, 'Approved photo was missing from all-status moderation history');
  equal((await request('PATCH', `/admin/memory-photos/${reviewedPhoto.id}/review`, memory.token, { status: 'REJECTED' }, 409)).status, 409);
  equal((await request('POST', '/admin/controls/voting.open', memory.token,
    { revision: (await request('GET', '/admin/settings', memory.token)).body.data.controls.revision, operationId: crypto.randomUUID() }, 403)).status, 403);
  equal((await request('GET', '/admin/vote-totals', memory.token, undefined, 403)).status, 403);
  equal(Object.hasOwn((await request('GET', '/admin/settings', memory.token)).body.data, 'ballotCount'), false);
  await memoryUi.page.getByRole('button', { name: 'Close', exact: true }).click();
  await memoryUi.page.setViewportSize({ width: 320, height: 760 }); await assertHealthy(memoryUi); await memoryUi.value.close();
  step('MEMORY_ADMIN toggle, all-status history, terminal approve/reject and cross-role restrictions');

  // Disable invalidates an already-issued browser session; logout is client-only and returns to login.
  const revoked = await context(); await login(revoked.page, 'browser-voting');
  await request('PATCH', `/admin/staff/${votingRecord.id}`, fixture.token, { status: 'disabled' });
  await revoked.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await revoked.page.getByRole('button', { name: 'Enter admin workspace →' }).waitFor();
  await assertHealthy(revoked); await revoked.value.close();
  const logout = await context(); await login(logout.page, 'browser-memory');
  await logout.page.getByRole('button', { name: 'Sign out' }).click(); await logout.page.getByRole('button', { name: 'Enter admin workspace →' }).waitFor();
  await assertHealthy(logout); await logout.value.close();
  const rootIdentity = jwt.decode(fixture.token);
  const expiredToken = jwt.sign({ role: 'admin', adminId: rootIdentity.adminId, v: rootIdentity.v }, fixture.secret, { expiresIn: -1 });
  equal((await request('GET', '/admin/settings', expiredToken, undefined, 401)).status, 401);
  step('Expired/revoked session rejection and explicit logout');

  await admin.page.setViewportSize({ width: 768, height: 900 }); await assertHealthy(admin);
  await admin.page.setViewportSize({ width: 320, height: 760 }); await assertHealthy(admin); await admin.value.close();
  console.log(JSON.stringify({ result: 'PASS', steps: steps.length, assertions }, null, 2));
} finally {
  await browser.close(); await vite.close(); await fixture.close();
}
process.exit(0);
