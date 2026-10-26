// Browser -> Vite proxy -> Express -> disposable v2 replica set -> browser.
// Uses generated accounts and private local storage; never reads config.env or AWS.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { createV2Fixture } = require('../../test/fixtures/v2Fixture.cjs');
const fixture = await createV2Fixture();
let vite, browser;
try {
  await fixture.reset();
  const email = 'wish-browser@example.test';
  await fixture.student(email);
  process.env.VOTING_API_TARGET = fixture.baseUrl;
  vite = await createServer({ configFile: 'vite.config.js', mode: 'development', server: { host: '127.0.0.1', port: 0 } });
  await vite.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [], consoleErrors = [], serverErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error') consoleErrors.push(event.text()); });
  page.on('response', response => { if (response.url().includes('/api/v1/') && response.status() >= 500) serverErrors.push([response.status(), response.url()]); });
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  await page.goto(`${base}/#wishes`);
  await page.getByText('The sky is waiting for its first wish.').waitFor();
  await page.getByRole('button', { name: 'Release a wish' }).click();
  const login = page.getByRole('dialog');
  await login.getByLabel('Email address').fill(email);
  await login.getByLabel('Password', { exact: true }).fill(fixture.password);
  await login.locator('form').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Send a little hope.' }).waitFor();
  await page.getByLabel('Your wish', { exact: true }).fill('A wish saved through the real v2 API');
  await page.getByRole('button', { name: 'Release my lantern' }).click();
  await page.getByText('2 of 3 wishes remaining', { exact: true }).waitFor();
  assert.equal(await fixture.db.collection('wishes').countDocuments(), 1);
  await page.reload();
  const lantern = page.getByRole('button', { name: 'Read wish 1', exact: true });
  await lantern.waitFor();
  const box = await lantern.locator('.wish-lantern-shape').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('dialog').getByText('A wish saved through the real v2 API').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await lantern.evaluate(element => document.activeElement === element), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(serverErrors, []);
  assert.equal(consoleErrors.every(message => /^Failed to load resource:/.test(message)), true);
  console.log('Wish Sky v2 live flow passed: browser -> API -> replica set -> browser.');
} finally {
  if (browser) await browser.close();
  if (vite) await vite.close();
  await fixture.close();
}
