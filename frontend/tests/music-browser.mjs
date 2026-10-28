import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.js', mode: 'fixtures', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: ['--no-sandbox'] });
const base = `http://127.0.0.1:${server.httpServer.address().port}`;

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#wishes`);
    const player = page.getByRole('complementary', { name: 'Festival music player' });
    await player.waitFor();
    await page.waitForFunction(() => document.querySelector('.music-player audio')?.duration > 0);
    const first = await player.locator('audio').getAttribute('src');
    assert.equal(first, '/music/town-with-an-ocean-view.mp3');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const playerBox = await player.boundingBox();
    const creditBox = await page.locator('.balloon-credit').boundingBox();
    assert.ok(Math.abs(playerBox.x + playerBox.width / 2 - creditBox.x - creditBox.width / 2) <= 2, 'Player should align with the caption center');
    assert.ok(playerBox.y + playerBox.height + 8 <= creditBox.y, 'Player should sit above the caption');
    assert.equal(await player.getByRole('slider').count(), 0);
    assert.ok(playerBox.width <= 90 && playerBox.height <= 80);
    assert.equal(await player.getByRole('button').count(), 1);
    assert.equal(await player.evaluate(element => getComputedStyle(element).backgroundImage), 'none');
    assert.equal(await player.locator('.music-player-play').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
    const iconBox = await player.locator('.music-player-icon').boundingBox();
    const playBox = await player.locator('.music-player-play').boundingBox();
    const controlsBox = await player.locator('.music-player-controls').boundingBox();
    assert.equal(await player.locator('.music-player-icon i').count(), 12);
    assert.equal(iconBox.width, controlsBox.width);
    assert.ok(iconBox.y + iconBox.height < playBox.y);
    if (viewport.width < 580) {
      const actionsBox = await page.locator('.sky-actions').boundingBox();
      assert.ok(playerBox.y + playerBox.height <= actionsBox.y, 'Mobile music player should clear Wish Sky actions');
    }
    if (await player.getByRole('button', { name: 'Play music' }).count()) await player.getByRole('button', { name: 'Play music' }).click();
    await player.getByRole('button', { name: 'Pause music' }).waitFor();
    assert.notEqual(await player.locator('.music-player-icon i').first().evaluate(bar => getComputedStyle(bar).animationName), 'none');
    await page.waitForFunction(() => document.querySelector('.music-player audio')?.currentTime > 0);
    await player.getByRole('button', { name: 'Pause music' }).click();
    await player.getByRole('button', { name: 'Play music' }).waitFor();
    assert.equal(await player.locator('audio').evaluate(audio => audio.paused), true);
    assert.equal(await player.locator('.music-player-icon i').first().evaluate(bar => getComputedStyle(bar).animationName), 'none');
    for (const expected of ['/music/gintama-lofi.mp3', '/music/isabellas-lullaby-guitar.mp3', first]) {
      await player.locator('audio').evaluate(audio => audio.dispatchEvent(new Event('ended')));
      await page.waitForFunction(src => document.querySelector('.music-player audio')?.getAttribute('src') === src, expected);
    }
    assert.equal(await player.locator('audio').getAttribute('src'), first);
    await page.goto(`${base}/#lanterns`);
    assert.equal(await player.count(), 0);
    await page.goto(`${base}/#home`);
    assert.equal(await player.count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Music player browser flow passed on desktop and mobile.');
} finally {
  await browser.close();
  await server.close();
}
