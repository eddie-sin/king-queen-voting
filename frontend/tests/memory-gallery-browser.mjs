import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.env.VOTING_API_TARGET = 'http://127.0.0.1:1';
const server = await createServer({ configFile: 'vite.config.js', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const png = await readFile('../postman/fixtures/memory-photo.png');
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('festival-language', 'en')); const errors = []; page.on('pageerror', e => errors.push(e.message));
    let mode = 'loading', imageFailure = false, release;
    const wait = new Promise(resolve => release = resolve);
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      assert.equal(route.request().headers().authorization, undefined);
      if (url.pathname.endsWith('/image')) {
        assert.match(url.pathname, /^\/api\/v1\/memory-photos\/[a-f0-9]{24}\/image$/);
        return route.fulfill(imageFailure ? { status: 404, body: 'Unavailable' } : { contentType: 'image/png', body: png });
      }
      if (url.pathname.endsWith('/auth/me')) return route.fulfill({ status: 401, json: { status: 'fail' } });
      assert.equal(url.pathname, '/api/v1/memory-photos');
      assert.equal(url.searchParams.get('limit'), '20');
      if (mode === 'loading') await wait;
      if (mode === 'network') return route.abort();
      if (mode === 'disabled') return route.fulfill({ status: 403, json: { status: 'fail' } });
      if (mode === 'malformed') return route.fulfill({ json: { status: 'success', data: { photos: [] } } });
      const n = Number(url.searchParams.get('page'));
      const photos = mode === 'empty' ? [] : Array.from({ length: n === 1 ? 20 : 1 }, (_, i) => ({ id: String((imageFailure ? 500 : 0) + n * 100 + i).padStart(24, '0'), createdAt: '2026-10-22T10:00:00Z', likeCount: 17 + i }));
      return route.fulfill({ json: { status: 'success', results: photos.length, pagination: { page: n, limit: 20, hasMore: mode !== 'empty' && n === 1 }, data: { photos } } });
    });
    await page.goto(`${base}/#memory-gallery`);
    await page.getByText('Gathering our little lights…').waitFor(); mode = 'ready'; release();
    await page.getByRole('button', { name: 'Sign in to like memory · 17 likes', exact: true }).waitFor();
    assert.equal(await page.locator('.mp-demo-chip').count(), 0);
    const open = page.getByRole('button', { name: 'Enlarge memory 1', exact: true });
    await open.focus(); await page.keyboard.press('Enter'); await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape'); assert(await open.evaluate(e => e === document.activeElement));
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText('Page 2', { exact: true }).waitFor(); assert(await page.getByRole('button', { name: 'Next', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Previous', exact: true }).click(); await page.getByText('Page 1', { exact: true }).waitFor();
    mode = 'disabled'; await page.getByRole('button', { name: 'Refresh gallery', exact: true }).click();
    await page.getByText('Our keepsake is resting.').waitFor(); assert.equal(await page.locator('.mp-print').count(), 0);
    for (const failure of ['network', 'malformed']) {
      mode = failure; await page.getByRole('button', { name: 'Try again' }).click(); await page.getByRole('alert').waitFor();
    }
    mode = 'empty'; await page.getByRole('button', { name: 'Try again' }).click(); await page.getByText('The first light is still to come.').waitFor();
    mode = 'ready'; imageFailure = true; await page.getByRole('button', { name: 'Refresh gallery', exact: true }).click();
    await page.locator('.mp-print').first().waitFor();
    await page.locator('.mp-print').first().scrollIntoViewIfNeeded();
    await page.getByText('This photo could not be loaded.').first().waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.deepEqual(errors, []);
    await page.getByRole('link', { name: 'View explicitly labeled demo gallery' }).click();
    await page.getByRole('button', { name: 'Enlarge demo photo 1', exact: true }).waitFor();
    await context.close();
  }
  console.log('PASS: desktop/mobile public gallery, loading, pagination, counts, keyboard viewer, disable, malformed/network/empty/image errors and explicit demo');
} finally { await browser?.close(); await server.close(); }
