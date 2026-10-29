import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.js', mode: 'fixtures', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: ['--no-sandbox'] });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('festival-language', 'en'));
  await page.goto(`${base}/#candidates`);
  await page.getByRole('heading', { name: /Every crown begins/ }).waitFor();
  assert.equal(await page.locator('nav').getByRole('link', { name: /Results|Finalists/ }).count(), 0);
  const royalResults = page.locator('main').getByRole('link', { name: 'Results', exact: true });
  assert.equal(await royalResults.count(), 1);
  await royalResults.click();
  assert.equal(new URL(page.url()).hash, '#results');
  await page.getByRole('heading', { name: /The results/i }).waitFor();

  await page.goto(`${base}/#lanterns`);
  await page.getByRole('heading', { name: /Lanterns and their stories/i }).waitFor();
  const lanternResults = page.locator('main').getByRole('link', { name: 'Results', exact: true });
  assert.equal(await lanternResults.count(), 1);
  await lanternResults.click();
  assert.equal(new URL(page.url()).hash, '#lantern-results');
  await page.getByRole('heading', { name: /Results will shine here/ }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#king`);
  await page.locator('main').getByRole('link', { name: 'Results', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log('PASS: section-specific Results links and separate routes work on desktop and mobile');
} finally {
  await browser.close();
  await server.close();
}
