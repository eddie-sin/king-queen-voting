import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.js', mode: 'fixtures', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const base = `http://127.0.0.1:${server.httpServer.address().port}`;

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#wishes`);
    await page.locator('.floating-wish').first().waitFor();
    assert.equal(await page.locator('.floating-wish').count(), viewport.width < 580 ? 12 : 24);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const releaseButton = await page.getByRole('button', { name: 'Release a wish' }).boundingBox();
    const quotaNote = page.locator('.wish-quota-note');
    const noteBox = await quotaNote.boundingBox();
    assert.ok(Math.abs(noteBox.x - releaseButton.x) <= 1);
    assert.ok(noteBox.y >= releaseButton.y + releaseButton.height && noteBox.y - releaseButton.y - releaseButton.height <= 12);
    assert.equal(await quotaNote.evaluate(element => getComputedStyle(element).textAlign), 'left');
    await page.getByRole('button', { name: 'Read wish 1', exact: true }).click();
    await page.getByRole('dialog').getByText(/May our small acts of kindness/).waitFor();
    await page.getByRole('button', { name: 'Read another wish' }).click();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Release a wish' }).click();
    const login = page.getByRole('dialog');
    await login.getByLabel('Email address').fill('demo@example.test');
    await login.getByLabel('Password', { exact: true }).fill('festival123');
    await login.getByRole('button', { name: 'Login', exact: true }).last().click();
    await page.getByRole('heading', { name: 'Send a little hope.' }).waitFor();
    for (let index = 1; index <= 3; index++) {
      await page.getByLabel('Your wish', { exact: true }).fill(index === 1 ? 'a'.repeat(600) : `Wish ${index}`);
      if (index === 1) assert.equal((await page.getByLabel('Your wish', { exact: true }).inputValue()).length, 600);
      await page.getByRole('button', { name: 'Release my lantern' }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByText(index === 3 ? 'Your three wishes have joined the sky.' : `${3 - index} of 3 wishes remaining`, { exact: true }).waitFor();
      if (index < 3) await page.getByRole('button', { name: 'Release a wish' }).click();
    }
    await page.getByRole('button', { name: 'Release a wish' }).click();
    assert.equal(await page.getByRole('button', { name: 'Release my lantern' }).isDisabled(), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Wish Sky browser flow passed on desktop and mobile.');
} finally {
  await browser.close();
  await server.close();
}
