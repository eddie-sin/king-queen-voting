import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.env.VOTING_API_TARGET = 'http://127.0.0.1:1';
// Use an ephemeral test port so an already-running manual preview is never
// disturbed by the browser suite.
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 } });
await server.listen(); let browser;
const token = 'generated-browser-fixture';
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const png = await readFile('../postman/fixtures/memory-photo.png');
  const file = name => ({ name, mimeType: 'image/png', buffer: png });
  async function setup(state = {}, width = 1440) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(({ token, signed }) => {
      if (signed) localStorage.setItem('thadingyut_voter_session', JSON.stringify({ token, user: { id: 'fixture-student' } }));
      window.previewCreated = []; window.previewRevoked = [];
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); window.previewCreated.push(url); return url; };
      URL.revokeObjectURL = url => { window.previewRevoked.push(url); revoke(url); };
    }, { token, signed: !state.anonymous });
    const page = await context.newPage(); const errors = [], posts = [], photos = [];
    let reads = 0, active = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      // v2 student auth uses the HttpOnly cookie session; browser requests
      // must not expose a bearer token to JavaScript or outgoing headers.
      assert.equal(request.headers().authorization, undefined);
      if (path.endsWith('/mine')) {
        reads++;
        if (state.mineStatus) return route.fulfill({ status: state.mineStatus, json: { status: 'fail' } });
        const remaining = state.remaining ?? Math.max(0, 3 - photos.length);
        return route.fulfill({ json: { status: 'success', results: photos.length, data: { photos, quota: { limit: 3, acceptedCount: photos.length, remainingSlots: state.changedQuota && reads > 1 ? 0 : remaining } } } });
      }
      if (path.endsWith('/auth/me')) return route.fulfill({ json: { status: 'success', data: { sessionKey: token, user: { id: 'fixture-student' } } } });
      assert.equal(path, '/api/v1/memory-photos'); assert.equal(request.method(), 'POST');
      assert.match(request.headers()['content-type'], /^multipart\/form-data; boundary=/);
      const body = request.postDataBuffer().toString('latin1');
      assert.equal((body.match(/name="images"/g) || []).length, 1);
      assert(!body.includes('name="userId"')); posts.push(body); active++; assert.equal(active, 1);
      await new Promise(resolve => setTimeout(resolve, 100));
      const failure = (state.failures || [])[posts.length - 1]; active--;
      if (failure === 'network') return route.abort();
      if (failure) return route.fulfill({ status: failure, json: { status: 'fail' } });
      const photo = { id: String(photos.length + 1).padStart(24, '0'), status: 'PENDING', createdAt: '2026-10-22T10:00:00Z' }; photos.push(photo);
      return route.fulfill({ status: 201, json: { status: 'success', data: { photo } } });
    });
    await page.goto(`${base}/#memory-upload`);
    return { page, context, posts, errors, photos };
  }
  for (const width of [1440, 390]) {
    const { page, context, posts, errors } = await setup({}, width);
    await page.getByText('Limit: 3 · Accepted: 0 · Remaining: 3').waitFor();
    await page.locator('input[type=file][multiple]').setInputFiles([file('one.png'), file('two.png')]);
    await page.getByRole('button', { name: 'Submit memories' }).click();
    await page.getByText('Uploading photo 1 of 2…', { exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Sending your memories…' }).isDisabled());
    await page.getByText('Limit: 3 · Accepted: 2 · Remaining: 1').waitFor();
    assert.equal(posts.length, 2); assert.equal(await page.locator('.mp-submitted .mp-envelope').count(), 2);
    assert.deepEqual(await page.evaluate(() => [previewCreated.length, previewRevoked.length]), [2, 2]);
    await page.getByRole('link', { name: 'View My Memories and current allowance →' }).click();
    await page.getByText('Pending review', { exact: true }).first().waitFor(); assert.equal(await page.locator('.mp-envelope').count(), 2);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.deepEqual(errors, []); await context.close();
  }
  {
    const { page, context, posts } = await setup({ remaining: 1 });
    await page.getByText('Limit: 3 · Accepted: 0 · Remaining: 1').waitFor();
    await page.locator('input[type=file][multiple]').setInputFiles([file('one.png'), file('two.png')]);
    assert.equal(await page.locator('.mp-slot.is-filled').count(), 1);
  await page.getByRole('alert').filter({ hasText: 'remaining active slots' }).waitFor();
    await page.getByRole('button', { name: 'Remove selected photo 1' }).click();
    assert.deepEqual(await page.evaluate(() => [previewCreated.length, previewRevoked.length]), [1, 1]);
    await page.locator('input[type=file][multiple]').setInputFiles({ name: 'bad.gif', mimeType: 'image/gif', buffer: png });
    await page.getByRole('alert').filter({ hasText: 'JPG, PNG or WebP' }).waitFor(); assert.equal(posts.length, 0); await context.close();
  }
  for (const failure of [400, 401, 403, 409, 500, 'network']) {
    const { page, context, posts } = await setup({ failures: [failure] });
    await page.getByRole('button', { name: 'Choose photos', exact: true }).waitFor();
    await page.getByText('Limit: 3 · Accepted: 0 · Remaining: 3').waitFor();
    await page.locator('input[type=file][multiple]').setInputFiles([file('one.png'), file('two.png')]);
    await page.getByRole('button', { name: 'Submit memories' }).click();
    if (failure === 401) await page.getByRole('alert').filter({ hasText: 'session has expired' }).waitFor();
    else await page.locator('.mp-upload-outcomes li').first().waitFor();
    if (failure === 400) {
      await page.getByText('Limit: 3 · Accepted: 1 · Remaining: 2').waitFor(); assert.equal(posts.length, 2);
      assert.equal(await page.locator('.mp-submitted .mp-envelope').count(), 1);
    } else {
      await page.waitForTimeout(400); assert.equal(posts.length, 1);
      if (failure === 500 || failure === 'network') {
        await page.getByText('Confirmation uncertain.', { exact: false }).waitFor();
        await page.getByRole('button', { name: 'Submit memories' }).click();
        await page.getByText('Limit: 3 · Accepted: 1 · Remaining: 2').waitFor();
        assert.equal(posts.length, 2); assert(posts[1].includes('two.png')); assert(!posts[1].includes('one.png'));
      }
      if (failure === 401) assert.equal(await page.evaluate(() => localStorage.getItem('thadingyut_voter_session')), null);
    }
    await context.close();
  }
  for (const state of [{ anonymous: true }, { mineStatus: 403 }, { changedQuota: true }]) {
    const { page, context, posts } = await setup(state);
    if (state.anonymous) await page.getByRole('link', { name: 'Sign in at the festival' }).waitFor();
    else if (state.mineStatus) await page.getByText('Memory Photo is currently disabled by the organisers.').waitFor();
    else {
      await page.getByText('Limit: 3 · Accepted: 0 · Remaining: 3').waitFor();
      await page.locator('input[type=file][multiple]').setInputFiles(file('one.png'));
      await page.getByRole('button', { name: 'Submit memories' }).click();
      await page.getByRole('alert').filter({ hasText: 'allowance has changed' }).waitFor();
    }
    assert.equal(posts.length, 0); await context.close();
  }
  {
    const { page, context, posts } = await setup();
    await page.getByText('Limit: 3 · Accepted: 0 · Remaining: 3').waitFor();
    await page.locator('input[type=file][multiple]').setInputFiles([file('one.png'), file('two.png')]);
    await page.getByRole('button', { name: 'Submit memories' }).click();
    await page.getByText('Uploading photo 1 of 2…', { exact: true }).waitFor();
    await page.evaluate(() => { localStorage.removeItem('thadingyut_voter_session'); window.dispatchEvent(new Event('storage')); });
    await page.getByRole('link', { name: 'Sign in at the festival' }).waitFor();
    await page.waitForTimeout(250); assert(posts.length <= 1);
    assert.equal(await page.locator('.mp-slot.is-filled, .mp-submitted .mp-envelope').count(), 0);
    assert.deepEqual(await page.evaluate(() => [previewCreated.length, new Set(previewRevoked).size]), [2, 2]);
    await context.close();
  }
  {
    const { page, context } = await setup();
    await page.getByText('Limit: 3 · Accepted: 0 · Remaining: 3').waitFor();
    await page.locator('input[type=file][multiple]').setInputFiles(file('one.png'));
    await page.getByRole('link', { name: 'Open explicitly labeled demo upload studio' }).click();
    await page.getByRole('button', { name: 'Preview submission' }).waitFor();
    assert.deepEqual(await page.evaluate(() => [previewCreated.length, new Set(previewRevoked).size]), [1, 1]);
    await context.close();
  }
  console.log('PASS: desktop/mobile sequential multipart uploads, progress, PENDING refresh, quota/file validation, preview cleanup, partial failures, expired/disabled access, uncertain-write stop and changed quota');
} finally { await browser?.close(); await server.close(); }
