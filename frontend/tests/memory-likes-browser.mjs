import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.env.VOTING_API_TARGET = 'http://127.0.0.1:1';
const server = await createServer({ configFile: 'vite.config.js', server: { host: '127.0.0.1', port: 0 } });
await server.listen(); let browser;
const id = n => String(n).padStart(24, '0');
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`, png = await readFile('../postman/fixtures/memory-photo.png');
  async function setup(state = {}, width = 1440) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    if (!state.anonymous) await context.addInitScript(() => localStorage.setItem('thadingyut_voter_session', JSON.stringify({ token: 'student-a', user: { id: 'a' } })));
    const page = await context.newPage(), batches = [], mutations = [], errors = [];
    const liked = { 'student-a': new Set([id(1)]), 'student-b': new Set() }, counts = new Map();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      const auth = req.headers().authorization?.replace('Bearer ', '');
      const ok = data => route.fulfill({ json: { status: 'success', data } });
      const fail = status => route.fulfill({ status, json: { status: 'fail' } });
      if (path.endsWith('/like-status')) {
        batches.push({ ids: url.searchParams.get('photoIds').split(','), auth });
        assert(auth); const requested = batches.at(-1).ids;
        if (state.batchWait) await new Promise(resolve => setTimeout(resolve, state.batchWait));
        if (state.batchFailure === 'network') return route.abort();
        if (state.batchFailure) return fail(state.batchFailure);
        const photos = requested.filter(value => value !== state.omitted).map(photoId => ({ photoId, liked: liked[auth]?.has(photoId) || false }));
        return route.fulfill({ json: { status: 'success', results: photos.length, data: { photos } } });
      }
      if (path.endsWith('/like')) {
        mutations.push({ auth, method: req.method(), id: path.split('/').at(-2) });
        assert.equal(req.postData(), null);
        if (state.mutationWait) await new Promise(resolve => setTimeout(resolve, state.mutationWait));
        if (state.mutationFailure === 'network') return route.abort();
        if (state.mutationFailure) { if (state.mutationFailure === 403) state.disabled = true; return fail(state.mutationFailure); }
        const photoId = mutations.at(-1).id, value = req.method() === 'POST';
        value ? liked[auth].add(photoId) : liked[auth].delete(photoId);
        counts.set(photoId, value ? 37 : 19);
        return ok({ photoId, liked: value, likeCount: counts.get(photoId) });
      }
      if (path.endsWith('/memory-photos')) {
        assert.equal(auth, undefined); if (state.disabled) return fail(403);
        const n = Number(url.searchParams.get('page'));
        const photos = Array.from({ length: n === 1 ? 20 : 1 }, (_, i) => ({ id: id(n === 1 ? i + 1 : 21), createdAt: '2026-10-22T10:00:00Z', likeCount: counts.get(id(i + 1)) ?? 5 }));
        return route.fulfill({ json: { status: 'success', results: photos.length, pagination: { page: n, limit: 20, hasMore: n === 1 }, data: { photos } } });
      }
      if (path.endsWith('/image')) return route.fulfill({ contentType: 'image/png', body: png });
      if (path.endsWith('/auth/login')) return ok({ token: 'student-a', user: { id: 'a', email: 'a@example.test' } });
      if (path.endsWith('/auth/me')) return ok({ user: { id: 'a', email: 'a@example.test' } });
      if (path.endsWith('/settings')) return ok({ schedule: { registrationClosesAt: '2099-01-01T00:00:00Z', votingOpensAt: '2099-01-02T00:00:00Z', votingClosesAt: '2099-01-03T00:00:00Z', resultsPublishedAt: '2099-01-04T00:00:00Z', timezone: 'Asia/Yangon' } });
      if (path.endsWith('/candidates')) return ok({ candidates: [] });
      if (path.endsWith('/images')) return ok({ images: [] });
      throw Error(`Unexpected API: ${path}`);
    });
    await page.goto(`${base}/#memory-gallery`);
    return { page, context, batches, mutations, errors };
  }
  const heart = (page, index = 0) => page.locator('.mp-print .mp-heart').nth(index);
  async function switchAccount(page, token) {
    await page.evaluate(token => { token ? localStorage.setItem('thadingyut_voter_session', JSON.stringify({ token, user: { id: token } })) : localStorage.removeItem('thadingyut_voter_session'); window.dispatchEvent(new Event('storage')); }, token);
  }
  for (const width of [1440, 390]) {
    const state = { mutationWait: 200 }, { page, context, batches, mutations, errors } = await setup(state, width);
    await page.getByRole('button', { name: 'Unlike memory · 5 likes', exact: true }).waitFor();
    assert.equal(batches.length, 1); assert.equal(batches[0].ids.length, 20);
    await heart(page).focus(); await page.keyboard.press('Enter');
    assert(await heart(page).isDisabled());
    await page.getByRole('button', { name: 'Like memory · 19 likes', exact: true }).waitFor();
    assert.equal(mutations[0].method, 'DELETE');
    await heart(page).click();
    await page.getByRole('button', { name: 'Unlike memory · 37 likes', exact: true }).waitFor();
    assert.equal(mutations[1].method, 'POST'); assert.equal(mutations.length, 2);
    assert.equal(await heart(page).getAttribute('aria-pressed'), 'true');
    assert.equal(await heart(page).locator('svg').evaluate(e => getComputedStyle(e).animationName), 'none');
    await page.getByRole('button', { name: 'Enlarge memory 1', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Unlike memory · 37 likes' }).waitFor(); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Refresh gallery', exact: true }).click();
    await page.getByRole('button', { name: 'Unlike memory · 37 likes', exact: true }).waitFor(); assert.equal(batches.length, 2);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Like memory · 37 likes', exact: true }).waitFor();
    assert.deepEqual(batches.at(-1).ids, [id(21)]);
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await page.getByRole('button', { name: 'Unlike memory · 37 likes', exact: true }).waitFor();
    await switchAccount(page, 'student-b');
    await page.getByRole('button', { name: 'Like memory · 37 likes', exact: true }).waitFor();
    assert.equal(batches.at(-1).auth, 'student-b');
    await switchAccount(page, null); await page.getByRole('button', { name: 'Sign in to like memory · 37 likes', exact: true }).waitFor();
    assert.equal(await heart(page).getAttribute('aria-pressed'), null); assert.deepEqual(errors, []); await context.close();
  }
  for (const failure of ['network', 401, 403]) {
    const state = { batchFailure: failure }, { page, context, mutations } = await setup(state);
    await page.locator('.mp-like-notice').waitFor(); assert.equal(mutations.length, 0);
    if (failure === 401) { await page.getByRole('button', { name: 'Sign in to like memory · 5 likes', exact: true }).first().waitFor(); assert.equal(await page.evaluate(() => localStorage.getItem('thadingyut_voter_session')), null); }
    else { assert(await heart(page).isDisabled()); state.batchFailure = null; await page.getByRole('button', { name: 'Retry heart states' }).click(); await page.getByRole('button', { name: 'Unlike memory · 5 likes', exact: true }).waitFor(); }
    await context.close();
  }
  for (const failure of ['network', 401, 403, 404]) {
    const state = { mutationFailure: failure }, { page, context, mutations } = await setup(state);
    await page.getByRole('button', { name: 'Unlike memory · 5 likes', exact: true }).waitFor(); await heart(page).click();
    await page.locator('.mp-like-notice').waitFor(); assert.equal(mutations.length, 1);
    if (failure === 403) await page.getByText('Our keepsake is resting.').waitFor();
    if (failure === 401) assert.equal(await page.evaluate(() => localStorage.getItem('thadingyut_voter_session')), null);
    await context.close();
  }
  {
    const state = { batchWait: 350 }, { page, context, batches } = await setup(state);
    await heart(page).waitFor(); assert(await heart(page).isDisabled());
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await switchAccount(page, 'student-b');
    await page.getByRole('button', { name: 'Like memory · 5 likes', exact: true }).waitFor();
    assert.deepEqual(batches.at(-1).ids, [id(21)]); assert.equal(batches.at(-1).auth, 'student-b');
    assert.equal(await page.locator('.mp-print').count(), 1); await context.close();
  }
  {
    const state = { mutationWait: 400 }, { page, context } = await setup(state);
    await page.getByRole('button', { name: 'Unlike memory · 5 likes', exact: true }).waitFor(); await heart(page).click();
    await switchAccount(page, 'student-b');
    await page.getByRole('button', { name: 'Like memory · 5 likes', exact: true }).first().waitFor();
    await page.waitForTimeout(450); assert.equal(await heart(page).getAttribute('aria-pressed'), 'false');
    assert.equal(await heart(page).textContent(), '5'); await context.close();
  }
  {
    const { page, context, batches } = await setup({ anonymous: true });
    await page.getByRole('button', { name: 'Sign in to like memory · 5 likes', exact: true }).first().waitFor(); assert.equal(batches.length, 0);
    await heart(page).click(); await page.waitForURL('**/#account');
    await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    await dialog.getByLabel('Email', { exact: false }).fill('a@example.test');
    await dialog.getByLabel('Password', { exact: true }).fill('generated-fixture-password');
    await dialog.locator('form').getByRole('button', { name: 'Login', exact: true }).click();
    await page.waitForURL('**/#memory-gallery'); await page.getByRole('button', { name: 'Unlike memory · 5 likes', exact: true }).waitFor();
    await context.close();
  }
  console.log('PASS: batched authenticated states, anonymous login/return, like/unlike response counts, refresh/pagination, locks, keyboard/reduced motion, errors, logout/account changes and stale responses');
} finally { await browser?.close(); await server.close(); }
