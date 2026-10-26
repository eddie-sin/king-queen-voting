import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = process.env.TEST_BASE_URL ? null : await createServer({ configFile: 'vite.config.js', mode: 'development', server: { host: '127.0.0.1', port: 0 } });
if (server) await server.listen();
const base = process.env.TEST_BASE_URL || `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
const candidates = ['king', 'queen'].flatMap(contest => [1, 2].map(index => ({
  _id: `${contest}-${index}`, fullName: `${contest === 'king' ? 'Aung' : 'May'} Sample ${index}`,
  category: contest, batchNumber: '2026', isActive: true, images: [`/art/source-${contest}.svg`],
  contactNumber: 'PRIVATE_CONTACT_MUST_NOT_RENDER',
})));
const initial = () => ({ controls: { registrationOpen: true, votingStatus: 'open', announcementOpen: false,
  memoryPhotosEnabled: false, round: 1, window: 1, revision: 1, candidateManagementLocked: true },
votes: {}, registered: 0, submissions: [], settingsFailure: false, candidateFailure: false });

async function setup(state, viewport = { width: 1440, height: 950 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage(); const errors = [], consoleErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error') consoleErrors.push(event.text()); });
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', '');
    const body = request.postData() ? request.postDataJSON() : null;
    const ok = data => route.fulfill({ json: { status: 'success', data } });
    const fail = (status, message) => route.fulfill({ status, json: { status: 'fail', message } });
    if (path === '/candidates') return state.candidateFailure ? fail(503, 'Candidate service unavailable.') : ok({ candidates });
    if (path === '/images') return ok({ images: [] });
    if (path === '/lantern-voting') return ok({ open: false, announced: false, window: 0, winner: null });
    if (path === '/settings') return state.settingsFailure ? fail(503, 'Controls temporarily unavailable.') : ok({ controls: state.controls });
    if (path === '/results') {
      if (!state.controls.announcementOpen || state.controls.votingStatus !== 'closed') return fail(403, 'Results announcement is not open.');
      return ok({ results: { round: state.controls.round, revision: state.controls.revision,
        kings: [{ candidate: candidates[0], votes: 2, title: 'King' }],
        queens: [{ candidate: candidates[2], votes: 1, title: 'Queen' }] } });
    }
    if (path === '/auth/register') { assert.equal(request.method(), 'POST'); state.registered++; return ok({ user: { id: 'u1', email: body.email } }); }
    if (path === '/auth/login') return ok({ token: 'student-jwt', user: { id: 'u1', email: body.email, round: state.controls.round } });
    assert.equal(request.headers().authorization, 'Bearer student-jwt');
    const user = { id: 'u1', email: 'student@example.test', round: state.controls.round,
      hasVotedKing: Boolean(state.votes.king), hasVotedQueen: Boolean(state.votes.queen) };
    if (path === '/auth/me') return ok({ user });
    if (path === '/voting/my-votes') {
      assert.equal(request.method(), 'GET');
      return ok({ votes: Object.entries(state.votes).map(([contest, candidate]) => ({ contest, candidate })),
        round: state.controls.round, window: state.controls.window });
    }
    if (path === '/voting/submit') {
      assert.equal(request.method(), 'POST'); state.submissions.push(body);
      if (body.round !== state.controls.round || body.window !== state.controls.window) return fail(409, 'Voting has changed.');
      if (state.controls.votingStatus !== 'open') return fail(409, 'Voting is closed.');
      const candidate = candidates.find(item => item._id === body.candidateId && item.category === body.contest);
      if (!candidate) return fail(400, 'Candidate unavailable.');
      if (state.votes[body.contest]) {
        if (state.votes[body.contest]._id === candidate._id) return ok({ alreadyRecorded: true });
        return fail(409, 'You have already voted in this category. Votes cannot be changed.');
      }
      state.votes[body.contest] = candidate;
      return route.fulfill({ status: 201, json: { status: 'success', data: { alreadyRecorded: false } } });
    }
    throw Error(`Unexpected API request: ${path}`);
  });
  await page.goto(`${base}/#king`); await page.getByRole('button', { name: 'Meet Aung' }).first().waitFor();
  return { page, context, errors, consoleErrors };
}

async function login(page) {
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email address').fill('student@example.test');
  await dialog.getByLabel('Password', { exact: true }).fill('fixture-password');
  await dialog.locator('form').getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}
async function vote(page, firstName) {
  await page.getByRole('button', { name: `Meet ${firstName}`, exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cast your crown', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm vote', exact: true }).click();
  await page.waitForURL('**/#account');
}

const report = [];
try {
  {
    const state = initial(); const { page, context, errors, consoleErrors } = await setup(state);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Register', exact: true }).click();
    await dialog.getByLabel('Email address').fill('new@example.test'); await dialog.getByLabel('Password', { exact: true }).fill('password123');
    await dialog.locator('form').getByRole('button', { name: 'Create account', exact: true }).click();
    await dialog.getByText('Your account is ready. Sign in below.').waitFor();
    assert.equal(state.registered, 1); assert.equal(await page.locator('#issued-key').count(), 0);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('thadingyut_voter_session')) || 'null'), null);
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); await context.close();
    report.push('registration uses manual registration control and creates no voting key or session');
  }
  {
    const state = initial(); const { page, context, errors, consoleErrors } = await setup(state); await login(page);
    assert.equal((await page.locator('body').innerText()).includes('PRIVATE_CONTACT_MUST_NOT_RENDER'), false);
    await vote(page, 'Aung'); await page.getByText('Vote recorded', { exact: true }).first().waitFor();
    assert.equal(state.votes.king._id, 'king-1');
    const outcomes = await page.evaluate(async ({ same, changed }) => {
      const session = JSON.parse(localStorage.getItem('thadingyut_voter_session'));
      const send = candidateId => fetch('/api/v1/voting/submit', { method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateId, contest: 'king', round: 1, window: 1 }) });
      return [(await send(same)).status, (await send(changed)).status];
    }, { same: 'king-1', changed: 'king-2' });
    assert.deepEqual(outcomes, [200, 409]); assert.equal(state.votes.king._id, 'king-1');
    await page.goto(`${base}/#queen`); await vote(page, 'May');
    assert.equal(state.votes.queen._id, 'queen-1'); assert.equal(state.votes.king._id, 'king-1');
    await page.reload(); await page.getByText('Vote recorded', { exact: true }).first().waitFor();
    assert(await page.evaluate(() => Boolean(localStorage.getItem('thadingyut_voter_session'))));
    state.controls.votingStatus = 'closed'; state.controls.window++; state.controls.revision++;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.goto(`${base}/#king`); await page.getByText('Voting is closed', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Meet Aung' }).nth(1).click();
    assert(await page.getByRole('dialog').getByRole('button', { name: 'Voting closed' }).isDisabled()); await page.keyboard.press('Escape');
    state.controls.announcementOpen = true; state.controls.revision++;
    await page.goto(`${base}/#results`); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByText('King', { exact: true }).waitFor(); await page.getByText('2 votes', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, ['Failed to load resource: the server responded with a status of 409 (Conflict)']);
    await context.close();
    report.push('final King/Queen votes persist; exact duplicate is idempotent, changed vote denied, closure and announcement enforced');
  }
  {
    const state = initial(); state.controls.registrationOpen = false; state.controls.votingStatus = 'closed';
    const { page, context, errors } = await setup(state, { width: 320, height: 700 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const button = page.getByRole('button', { name: 'Meet Aung' }).first(); await button.focus(); await page.keyboard.press('Enter');
    await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); assert(await button.evaluate(element => element === document.activeElement));
    state.candidateFailure = true; await page.reload(); await page.getByRole('button', { name: 'Retry candidates' }).waitFor();
    state.candidateFailure = false; state.settingsFailure = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('button', { name: 'Refresh status' }).waitFor(); assert.deepEqual(errors, []); await context.close();
    report.push('320px layout, keyboard dialog focus, candidate/control error states');
  }
  console.log(report.map(item => `PASS: ${item}`).join('\n'));
} finally { await browser.close(); await server?.close(); }
