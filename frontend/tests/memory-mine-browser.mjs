/* Connected-page browser checks against intercepted HTTP contracts, never real accounts. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';

process.env.VOTING_API_TARGET = 'http://127.0.0.1:1';
const server = await createServer({ configFile: 'vite.config.js', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
let browser;
const photos = ['PENDING', 'APPROVED', 'REJECTED'].map((status, index) => ({ id: String(index + 1).padStart(24, '0'), status, createdAt: '2026-10-22T10:00:00.000Z' }));
const regular = { photos, quota: { limit: 3, acceptedCount: 3, remainingSlots: 0 } };
const session = { token: 'current-student-fixture', user: { id: 'student-fixture', email: 'student@example.test' } };
const reports = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const png = await readFile('../postman/fixtures/memory-photo.png');
  await mkdir('test-artifacts/memory', { recursive: true });
  async function setup(state = {}, signedIn = true, width = 1440) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
    if (signedIn) await context.addInitScript(value => localStorage.setItem('thadingyut_voter_session', JSON.stringify(value)), session);
    const page = await context.newPage();
    const requests = [], images = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      requests.push({ path, token: route.request().headers().authorization });
      const send = (data, status = 200) => route.fulfill({ status, json: status === 200 ? { status: 'success', data } : { status: 'fail', message: 'Unavailable' } });
      if (path.endsWith('/memory-photos/mine')) {
        assert.equal(route.request().method(), 'GET');
        assert.equal(route.request().headers().authorization, `Bearer ${state.token || session.token}`);
        if (state.network) return route.abort();
        if (state.wait) await new Promise(resolve => setTimeout(resolve, state.wait));
        return send(state.data || regular, state.status || 200);
      }
      if (path.endsWith('/auth/me')) return send({ user: session.user }, state.accountStatus || 200);
      if (path.endsWith('/image')) {
        images.push(path);
        assert.equal(path, `/api/v1/memory-photos/${photos[1].id}/image`);
        assert.equal(route.request().headers().authorization, undefined);
        return state.imageError ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'Image unavailable' })
          : route.fulfill({ status: 200, contentType: 'image/png', body: png });
      }
      throw new Error(`Unexpected API request: ${path}`);
    });
    await page.goto(`${base}/#my-memories`);
    return { page, context, requests, images, errors };
  }
  for (const width of [1440, 390]) {
    const state = {};
    const { page, context, images, errors } = await setup(state, true, width);
    await page.getByText('Pending review', { exact: true }).waitFor();
    await page.getByText('Rejected', { exact: true }).waitFor();
    await page.getByText('Approved · opened & shared', { exact: true }).waitFor();
    assert.equal(await page.locator('.mp-envelope').count(), 2);
    assert.equal(await page.locator('.mp-envelope img').count(), 0);
    assert.equal(await page.locator('.mp-my-page .mp-demo-chip').count(), 0);
    assert.equal(await page.locator('.mp-my-page').getByText('Sample review state · no real submission').count(), 0);
    await page.locator('.mp-photo-open img').evaluate(image => image.decode());
    assert(images.length >= 1);
    assert(images.every(path => path.includes(photos[1].id)));
    assert.deepEqual(await page.locator('.mp-quota dd').allTextContents(), ['3', '3', '0']);
    await page.screenshot({ path: `test-artifacts/memory/connected-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Enlarge approved memory 2' }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    // A feature disable must remove both metadata and any enlarged image.
    state.status = 403;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('heading', { name: 'Our keepsake is resting.' }).waitFor();
    assert.equal(await page.locator('.mp-my-page .mp-print, .mp-my-page .mp-envelope, .mp-quota').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []); await context.close();
  }
  reports.push('Desktop/mobile: real statuses, private envelopes, approved backend image/viewer, server quota, disable clears data');
  {
    const { page, context, requests } = await setup({}, false);
    await page.getByRole('link', { name: 'Sign in at the festival' }).waitFor();
    assert.equal(requests.length, 0);
    assert.equal(await page.locator('.mp-my-page img').count(), 0);
    await page.getByRole('link', { name: 'View explicitly labeled sample states' }).click();
    await page.getByText('Sample review state · no real submission').first().waitFor();
    assert.equal(requests.length, 0); await context.close();
  }
  reports.push('Anonymous view requires the existing sign-in flow; explicit demo makes no API requests');
  for (const [state, heading] of [[{ status: 401 }, 'A fresh hello.'], [{ status: 403, accountStatus: 403 }, 'Student access is unavailable.'], [{ network: true }, 'Your memories need a moment.']]) {
    const { page, context } = await setup(state);
    await page.getByRole('heading', { name: heading }).waitFor();
    assert.equal(await page.locator('.mp-quota, .mp-my-page img').count(), 0);
    if (state.status === 401 || state.accountStatus === 403) assert.equal(await page.evaluate(() => localStorage.getItem('thadingyut_voter_session')), null);
    if (state.network) {
      state.network = false;
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.getByText('Pending review', { exact: true }).waitFor();
    }
    await context.close();
  }
  reports.push('Expired and disabled accounts clear the shared session; network errors retry without demo fallback');
  for (const [data, quota] of [[{ photos: [], quota: { limit: 3, acceptedCount: 0, remainingSlots: 2 } }, ['3', '0', '2']], [{ photos: [photos[1]], quota: { limit: 3, acceptedCount: 2, remainingSlots: 0 } }, ['3', '2', '0']]]) {
    const { page, context } = await setup({ data });
    await page.locator('.mp-quota').waitFor();
    assert.deepEqual(await page.locator('.mp-quota dd').allTextContents(), quota);
    if (!data.photos.length) await page.getByRole('heading', { name: 'A blank page, full of possibility.' }).waitFor();
    await context.close();
  }
  reports.push('Empty history and reserved/deleted-history capacity use backend counts, never visible-card counts');
  {
    const { page, context } = await setup({ imageError: true });
    await page.getByText('This photo could not be loaded.').waitFor();
    assert.equal(await page.locator('.mp-my-page img[src*="memory-photo/"]').count(), 0);
    await context.close();
  }
  {
    const { page, context } = await setup({ wait: 500 });
    await page.getByRole('heading', { name: 'Opening your keepsake…' }).waitFor();
    await page.evaluate(() => { localStorage.removeItem('thadingyut_voter_session'); window.dispatchEvent(new Event('storage')); });
    await page.getByRole('link', { name: 'Sign in at the festival' }).waitFor();
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.mp-quota, .mp-my-page .mp-print').count(), 0);
    await context.close();
  }
  reports.push('Image errors have no sample-image fallback; late responses cannot restore data after sign-out');
  {
    const { page, context } = await setup({}, true, 390);
    await page.getByText('Pending review', { exact: true }).waitFor();
    assert.equal(await page.locator('.mp-header').count(), 0);
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    assert.equal(await page.locator('#mobile-nav-drawer a[href="#memory-gallery"]').getAttribute('aria-current'), 'page');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#mobile-nav-drawer').count(), 0);
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('link', { name: 'Sign in at the festival' }).waitFor();
    assert.equal(await page.locator('.mp-envelope, .mp-quota, .mp-opened').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('thadingyut_voter_session')), null);
    await context.close();
  }
  reports.push('Shared main navbar, active Memory link, mobile Escape and immediate private-history clearing on sign-out');
  console.log(reports.map(text => `PASS: ${text}`).join('\n'));
} finally { await browser?.close(); await server.close(); }
