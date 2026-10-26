import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.js', mode: 'development', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
const base = `http://127.0.0.1:${server.httpServer.address().port}`;

try {
  for (const scenario of [
    { viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' },
    { viewport: { width: 768, height: 900 }, reducedMotion: 'reduce' },
    { viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' },
    { viewport: { width: 320, height: 760 }, reducedMotion: 'reduce' },
  ]) {
    const { viewport, reducedMotion } = scenario;
    const context = await browser.newContext({ viewport, reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let signedIn = false, used = 0;
    await page.route('**/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname;
      const ok = data => route.fulfill({ json: { status: 'success', data } });
      if (path.endsWith('/config')) return ok({ csrfToken: 'wish-browser-csrf', googleClientId: null });
      if (path.endsWith('/pending')) return ok({ flow: null });
      if (path.endsWith('/login')) { signedIn = true; return ok({ sessionKey: 'wish-browser-session', user: { id: 'wish-user', email: 'demo@gmail.com' } }); }
      if (path.endsWith('/me')) return signedIn ? ok({ sessionKey: 'wish-browser-session', user: { id: 'wish-user', email: 'demo@gmail.com' } }) : route.fulfill({ status: 401, json: { status: 'fail', message: 'Sign in to continue.' } });
      if (path.endsWith('/wishes/mine')) return ok({ used, remaining: Math.max(0, 3 - used) });
      if (path.endsWith('/wishes') && route.request().method() === 'POST') {
        if (used >= 3) return route.fulfill({ status: 409, json: { status: 'fail', message: 'Wish limit reached.' } });
        used++; return ok({ wish: { id: `created-${used}`, message: route.request().postDataJSON().message } });
      }
      if (path.endsWith('/wishes')) return ok({ wishes: Array.from({ length: 24 }, (_, index) => ({ id: `wish-${index + 1}`, message: `Festival wish ${index + 1}` })), nextCursor: null, total: 24 });
      if (path.endsWith('/voting/my-votes')) return ok({ votes: [], round: 1, window: 1 });
      if (path.endsWith('/settings')) return ok({ controls: { registrationOpen: true, votingStatus: 'closed', announcementOpen: false, memoryPhotosEnabled: false, round: 1, window: 1, revision: 0, candidateManagementLocked: false } });
      if (path.endsWith('/lantern-voting')) return ok({ open: false, announced: false, window: 0, winner: null });
      if (path.endsWith('/candidates')) return ok({ candidates: [] });
      if (path.endsWith('/images')) return ok({ images: [] });
      throw Error(`Unexpected API request: ${path}`);
    });
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
    const visibleTargets = await page.evaluate(() => [...document.querySelectorAll('.floating-wish')].flatMap(button => {
      const rect = button.querySelector('.wish-lantern-shape').getBoundingClientRect();
      if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return [];
      const expected = button.getAttribute('aria-label'), points = [];
      for (const fx of [.15,.3,.5,.7,.85]) for (const fy of [.12,.3,.5,.7,.88]) {
        const x=rect.x+rect.width*fx,y=rect.y+rect.height*fy;
        if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
        points.push({x,y,actual:document.elementFromPoint(x,y)?.closest('button')?.getAttribute('aria-label')});
      }
      if (!points.some(point => point.actual?.startsWith('Read wish'))) return [];
      return [{ expected, point: points.find(point => point.actual === expected) || null }];
    }));
    assert.ok(visibleTargets.length, 'At least one wish lantern must be visible');
    const target = visibleTargets.find(item => item.point);
    assert.ok(target, 'At least one exposed visible wish lantern must be clickable');
    const point = target.point;
    const firstWish = page.getByRole('button', { name: target.expected, exact: true });
    await page.mouse.click(point.x, point.y);
    await page.getByRole('dialog').locator('.wish-message').waitFor();
    await page.getByRole('button', { name: 'Read another wish' }).click();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    assert.equal(await firstWish.evaluate(element => document.activeElement === element), true);
    await firstWish.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').locator('.wish-message').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await firstWish.evaluate(element => document.activeElement === element), true);
    await page.getByRole('button', { name: 'Release a wish' }).click();
    const login = page.locator('dialog.account-dialog');
    await login.getByLabel('Gmail address').fill('demo@gmail.com');
    await login.getByLabel('Password', { exact: true }).fill('festival123');
    await login.locator('form').getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForTimeout(200);
    if (await login.getByRole('alert').count()) throw Error(`Wish fixture login failed: ${await login.getByRole('alert').innerText()}`);
    await login.waitFor({ state: 'detached' });
    if (!await page.getByRole('heading', { name: 'Send a little hope.' }).count()) await page.getByRole('button', { name: 'Release a wish' }).click();
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
  console.log('Wish Sky browser flow passed on desktop, tablet, mobile, 320px and reduced motion.');
} finally {
  await browser.close();
  await server.close();
}
