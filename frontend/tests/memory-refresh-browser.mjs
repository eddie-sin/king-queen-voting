// Real React pages with intercepted API/image responses; no real accounts, S3 or email.
import { chromium, webkit } from 'playwright';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

process.env.VOTING_API_TARGET = 'http://127.0.0.1:1';
const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const png = await readFile('../postman/fixtures/memory-photo.png');
const id = number => String(number).padStart(24, '0');
const photo = (number, status = 'APPROVED') => ({ id: id(number), status, createdAt: '2026-10-27T10:00:00Z', likeCount: 2 });
const until = async predicate => {
  for (let n = 0; n < 300; n++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw Error('Fixture request did not arrive');
};
const loaded = async locator => {
  await locator.waitFor(); await locator.scrollIntoViewIfNeeded();
  await until(async () => locator.evaluate(element => element.complete && element.naturalWidth > 0).catch(() => false));
};
await mkdir('test-artifacts/memory-refresh', { recursive: true });
let browser;
try {
  const chromePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform === 'darwin' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null);
  for (const engine of (process.env.MEMORY_REFRESH_BROWSER ? [process.env.MEMORY_REFRESH_BROWSER] : ['chromium', 'webkit'])) {
    browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true,
      ...(engine === 'chromium' && chromePath ? { executablePath: chromePath } : {}) });
    async function setup(routeName, width = 1440, options = {}) {
      const state = { account: 'a', enabled: true, publicPhotos: [photo(1)], histories: { a: [photo(1), photo(2, 'PENDING')], b: [photo(3)] },
        pending: [], imageFailures: new Set(), imageReads: [], reads: { gallery: 0, mine: 0 }, ...options };
      const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install();
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url()), name = url.pathname;
        assert.equal(request.headers().authorization, undefined, 'Student credentials must stay in cookies');
        const ok = data => route.fulfill({ json: { status: 'success', data } });
        const fail = status => route.fulfill({ status, json: { status: 'fail', message: 'Unavailable' } });
        if (name.endsWith('/auth/me')) return state.account ? ok({ sessionKey: `fixture-${state.account}`, user: { id: id(state.account === 'a' ? 51 : 52), email: `${state.account}@gmail.com` } }) : fail(401);
        if (name.endsWith('/auth/config')) return ok({ csrfToken: 'fixture-csrf', googleClientId: null });
        if (name.endsWith('/auth/pending')) return ok({ flow: null });
        if (name.endsWith('/auth/logout')) { state.account = null; return ok({}); }
        if (name.endsWith('/settings')) return ok({ controls: { registrationOpen: true, memoryPhotosEnabled: state.enabled, votingStatus: 'closed', announcementOpen: false, lanternVotingOpen: false, lanternAnnouncementOpen: false, lanternWindow: 1, round: 1, window: 1, revision: 1, candidateManagementLocked: false } });
        if (name.endsWith('/voting/my-votes')) return ok({ votes: [], round: 1, window: 1 });
        if (name.endsWith('/lantern-voting')) return ok({ open: false, announced: false, window: 1, winner: null });
        if (name.endsWith('/candidates')) return ok({ candidates: [] });
        if (name.endsWith('/images')) return ok({ images: [] });
        if (name.endsWith('/like-status')) return ok({ photos: url.searchParams.get('photoIds').split(',').map(photoId => ({ photoId, liked: false })) });
        if (name.endsWith('/image')) {
          state.imageReads.push(name);
          return route.fulfill(state.imageFailures.has(name.split('/').at(-2)) ? { status: 503, body: 'Unavailable' }
            : { contentType: 'image/png', headers: { 'Cache-Control': 'no-store' }, body: png });
        }
        const kind = name.endsWith('/memory-photos/mine') ? 'mine' : name.endsWith('/memory-photos') ? 'gallery' : null;
        assert(kind, `Unexpected fixture request: ${name}`);
        state.reads[kind]++;
        if (!state.enabled) return fail(403);
        if (kind === 'mine' && !state.account) return fail(401);
        let payload;
        if (kind === 'gallery') {
          const photos = state.publicPhotos.map(({ status, ...entry }) => ({ ...entry }));
          payload = { status: 'success', results: photos.length, pagination: { page: Number(url.searchParams.get('page')), limit: 20, hasMore: false }, data: { photos } };
        } else {
          const photos = state.histories[state.account].map(({ likeCount, ...entry }) => ({ ...entry }));
          const active = photos.filter(entry => ['APPROVED', 'PENDING', 'ARCHIVED'].includes(entry.status)).length;
          payload = { status: 'success', results: photos.length, data: { photos, quota: { limit: 3, acceptedCount: active, remainingSlots: 3 - active } } };
        }
        if (state.pauseNext === kind) { state.pauseNext = null; await new Promise(resolve => state.pending.push(resolve)); }
        try { return await route.fulfill({ json: payload }); }
        catch (error) { if (!request.failure()) throw error; }
      });
      await page.goto(`${base}/#${routeName}`);
      return { page, context, state, errors };
    }

    for (const width of [1440, 390]) {
      {
        const { page, context, state, errors } = await setup('memory-gallery', width);
        const image = page.locator('.mp-print img').first(); await loaded(image);
        const retained = await image.elementHandle();
        await page.getByRole('button', { name: 'Enlarge memory 1', exact: true }).click();
        await loaded(page.getByRole('dialog').locator('img'));
        const imageReads = state.imageReads.length;
        state.pauseNext = 'gallery';
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await until(() => state.pending.length);
        assert(await page.getByRole('dialog').isVisible());
        assert(await retained.evaluate(element => element.isConnected));
        assert.equal(await page.getByText('Gathering our little lights…', { exact: true }).count(), 0);
        const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/memory-photos');
        state.pending.shift()(); await response;
        await loaded(page.getByRole('dialog').locator('img'));
        assert.equal(state.imageReads.length, imageReads, 'Focus refresh must not re-download loaded photos');
        const previous = state.reads.gallery;
        await page.clock.fastForward(30001); await until(() => state.reads.gallery > previous);
        assert(await page.getByRole('dialog').isVisible());
        assert(await retained.evaluate(element => element.isConnected));
        assert.equal(state.imageReads.length, imageReads, 'Timer refresh must not remount loaded photos');
        await page.screenshot({ path: `test-artifacts/memory-refresh/gallery-${engine}-${width}.png` });
        state.publicPhotos = [];
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.getByText('The first light is still to come.', { exact: true }).waitFor();
        assert.equal(await page.getByRole('dialog').count(), 0);
        assert.equal(await page.locator('.mp-print img').count(), 0);
        assert.deepEqual(errors, []); await context.close();
      }
      {
        const { page, context, state, errors } = await setup('my-memories', width);
        await page.getByText('Pending review', { exact: true }).waitFor();
        const image = page.locator('.mp-print img').first(); await loaded(image);
        const retained = await image.elementHandle();
        await page.getByRole('button', { name: 'Enlarge approved memory 1' }).click();
        await loaded(page.getByRole('dialog').locator('img'));
        const imageReads = state.imageReads.length;
        state.pauseNext = 'mine';
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await until(() => state.pending.length);
        assert(await page.getByRole('dialog').isVisible());
        assert(await retained.evaluate(element => element.isConnected));
        assert.equal(await page.getByText('Opening your keepsake…', { exact: true }).count(), 0);
        const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/memory-photos/mine');
        state.pending.shift()(); await response;
        const previous = state.reads.mine;
        await page.clock.fastForward(30001); await until(() => state.reads.mine > previous);
        assert(await page.getByRole('dialog').isVisible());
        assert(await retained.evaluate(element => element.isConnected));
        assert.equal(state.imageReads.length, imageReads);
        state.histories.a[0].status = 'ARCHIVED';
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.getByText('Archived · hidden from gallery', { exact: true }).waitFor();
        assert.equal(await page.getByRole('dialog').count(), 0, 'A changed photo status must close the old viewer');
        state.enabled = false;
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.getByText('Our keepsake is resting.', { exact: true }).waitFor();
        assert.equal(await page.locator('.mp-print img').count(), 0);
        assert.deepEqual(errors, []); await context.close();
      }
    }
    {
      const { page, context, state, errors } = await setup('my-memories', 390);
      await page.getByText('Pending review', { exact: true }).waitFor();
      state.pauseNext = 'mine';
      await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await until(() => state.pending.length);
      state.account = 'b';
      await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'festival-account-change' })));
      await page.locator(`img[src*="${id(3)}"]`).waitFor();
      assert.equal(await page.locator(`img[src*="${id(1)}"]`).count(), 0, 'The previous account image must be cleared');
      state.pending.shift()();
      await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('tab', { name: /^Sign in/ }).waitFor();
      assert.equal(await page.locator('.mp-print, .mp-quota').count(), 0);
      assert.deepEqual(errors, []); await context.close();
    }
    for (const routeName of ['memory-gallery', 'my-memories']) {
      const { page, context, state, errors } = await setup(routeName, 1440, { imageFailures: new Set([id(1)]) });
      await page.getByText('This photo could not be loaded.', { exact: true }).waitFor();
      state.imageFailures.clear();
      await page.locator('.mp-print').first().getByRole('button', { name: routeName === 'memory-gallery' ? 'Refresh gallery' : 'Refresh memories', exact: true }).click();
      await loaded(page.locator('.mp-print img').first());
      assert.equal(await page.getByText('This photo could not be loaded.', { exact: true }).count(), 0);
      await page.getByRole('button', { name: routeName === 'memory-gallery' ? 'Enlarge memory 1' : 'Enlarge approved memory 1', exact: true }).click();
      // Browsers can reuse a decoded thumbnail for the same viewer URL. Exercise
      // the viewer's error event without requiring an unnecessary second download.
      await loaded(page.getByRole('dialog').locator('img'));
      await page.getByRole('dialog').locator('img').dispatchEvent('error');
      await page.getByRole('dialog').getByRole('button', { name: 'Try loading photo again' }).waitFor();
      state.imageFailures.clear();
      await page.getByRole('button', { name: 'Try loading photo again' }).click();
      await loaded(page.getByRole('dialog').locator('img'));
      state.enabled = false;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.getByText('Our keepsake is resting.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.deepEqual(errors, []); await context.close();
    }
    console.log(`PASS ${engine}: desktop/mobile quiet focus/timer refresh, retained image nodes/viewers, no image re-download, revocation, archive change, disabled feature, account switch, logout, stale response and image retry.`);
    await browser.close(); browser = null;
  }
} finally { await browser?.close(); await server.close(); }
