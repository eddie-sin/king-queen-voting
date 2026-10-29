import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { translate } from '../src/i18n/locale.js';

const server = await createServer({ configFile: 'vite.config.js', server: { host: '127.0.0.1', port: 0, strictPort: false } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
});
const png = await readFile('../postman/fixtures/memory-photo.png');
const id = n => String(n).padStart(24, '0');
const photos = ['APPROVED', 'PENDING', 'REJECTED'].map((status, index) => ({ id: id(index + 1), status, createdAt: '2026-10-27T10:00:00Z' }));
const errors = [];
const measurements = [];
const spacingChecks = [];
await mkdir('test-artifacts/language', { recursive: true });


async function collectMetrics(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => {
    const path = element => {
      let value = '';
      while (element?.parentElement && !['MAIN', 'HEADER', 'DIALOG', 'FOOTER'].includes(element.tagName)) {
        const index = [...element.parentElement.children].indexOf(element) + 1;
        value = `${element.tagName.toLowerCase()}:nth-child(${index})>${value}`;
        element = element.parentElement;
      }
      return `${element?.tagName}:${value}`;
    };
    return [...document.querySelectorAll('header a, header button, main h1, main h2, main h3, main p, main button, main a, main label, main .eyebrow, main .mp-eyebrow, main .mp-tabs a, main .mp-status, main .mp-date, main .mp-counter, main .mp-signature, main .mp-demo-note > span:last-child, main .home-hero-caption, footer a, footer p, footer span, footer small, dialog[open] h1, dialog[open] h2, dialog[open] h3, dialog[open] p, dialog[open] button, dialog[open] a, dialog[open] label, dialog[open] .eyebrow')]
      .filter(element => element.checkVisibility() && element.textContent.trim() && element.getBoundingClientRect().height > 2 && element.getBoundingClientRect().width > 2)
      .map(element => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        // Range fragments give actual text rows, including inline emphasis.
        const range = document.createRange(); range.selectNodeContents(element);
        const rows = [];
        for (const item of range.getClientRects()) {
          if (item.width > .5 && item.height > .5 && !rows.some(top => Math.abs(top - item.top) < item.height * .55)) rows.push(item.top);
        }
        const containsBlocks = Boolean(element.querySelector('h1, h2, h3, p, img'));
        return { key: path(element), tag: element.tagName, text: element.textContent.trim(), width: rect.width, height: rect.height, rows: containsBlocks ? null : rows.length, font: style.fontSize };
      });
  });
}
async function checkSpacing(page, width, route) {
  const checks = await page.evaluate(() => {
    const checks = [];
    const visible = node => {
      const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      return element?.checkVisibility() && element.getBoundingClientRect().width > 2 && element.getBoundingClientRect().height > 2;
    };
    const ink = element => {
      const range = document.createRange(); range.selectNodeContents(element);
      return range.getBoundingClientRect();
    };
    const pair = (title, subtitle, name, minimum = 3) => {
      if (!visible(title) || !visible(subtitle)) return;
      const a = ink(title), b = ink(subtitle);
      if (a.right <= b.left || b.right <= a.left) return;
      checks.push({ name, gap: b.top - a.bottom, minimum });
    };
    document.querySelectorAll('.brand-copy').forEach(copy => pair(copy.querySelector('.brand-title'), copy.querySelector('small'), 'brand subtitle', 4));
    for (const selector of ['.source-heading h1', '.home-hero h1', '.home-block h2', '.dev-intro h1', '.mp-my-heading h1', '.mp-studio h2', '.mp-review h3', '.candidate-copy h3', '.lantern-card-body h2', '.auth-visual-title']) {
      document.querySelectorAll(selector).forEach(title => {
        const next = title.nextElementSibling;
        if (next?.matches('p, h3')) pair(title, next, selector);
      });
    }
    document.querySelectorAll('.auth-header .auth-eyebrow').forEach(eyebrow => pair(eyebrow, eyebrow.nextElementSibling, 'account eyebrow'));
    document.querySelectorAll('.mp-local-note strong, .mp-review-explanation strong').forEach(title => {
      let next = title.nextSibling;
      while (next && !next.textContent.trim()) next = next.nextSibling;
      if (next) pair(title, next, 'memory note subtitle');
    });
    document.querySelectorAll('.mp-submission-copy').forEach(copy => {
      [...copy.children].slice(0, -1).forEach(title => pair(title, title.nextElementSibling, 'submission caption'));
    });
    document.querySelectorAll('.auth-field-group').forEach(field => {
      const label = field.querySelector('.auth-label-row label'), input = field.querySelector('.auth-input-wrapper');
      if (visible(label) && visible(input)) checks.push({ name: 'form label', gap: input.getBoundingClientRect().top - ink(label).bottom, minimum: 5 });
    });
    return checks;
  });
  spacingChecks.push(...checks.map(check => ({ ...check, width, route })));
}
function compareLayouts(english, burmese, width, route) {
  const byKey = new Map(burmese.map(item => [item.key, item]));
  for (const en of english) {
    const my = byKey.get(en.key);
    if (my) measurements.push({ width, route, english: en, my });
  }
}
async function setLanguage(page, language) {
  await page.evaluate(language => {
    localStorage.setItem('festival-language', language);
    window.dispatchEvent(new StorageEvent('storage', { key: 'festival-language', newValue: language }));
  }, language);
  await page.waitForFunction(language => document.documentElement.lang === language, language);
}
async function compareOpenState(page, width, route, restore = 'my') {
  if (!process.env.LANGUAGE_LAYOUT_AUDIT) return;
  await setLanguage(page, 'en'); const english = await collectMetrics(page);
  await setLanguage(page, 'my'); const burmese = await collectMetrics(page);
  await checkSpacing(page, width, route);
  compareLayouts(english, burmese, width, route);
  if (restore !== 'my') await setLanguage(page, restore);
}

try {
  for (const width of (process.env.LANGUAGE_TEST_WIDTHS?.split(',').map(Number) || [1440, 390, 320])) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    let signedIn = false;
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url()), endpoint = url.pathname.replace('/api/v1', '');
      const ok = data => route.fulfill({ json: { status: 'success', data } });
      const user = { id: id(20), email: 'student@gmail.com', round: 1, hasVotedKing: false, hasVotedQueen: false };
      if (endpoint === '/auth/config') return ok({ csrfToken: 'fixture-csrf', googleClientId: null });
      if (endpoint === '/auth/pending') return ok({ flow: null });
      if (endpoint === '/auth/login') { signedIn = true; return ok({ sessionKey: 'fixture-session', user }); }
      if (endpoint === '/auth/me') return signedIn ? ok({ sessionKey: 'fixture-session', user }) : route.fulfill({ status: 401, json: { status: 'fail', message: 'Sign in to continue.' } });
      if (endpoint === '/settings') return ok({ controls: { registrationOpen: true, votingStatus: 'open', announcementOpen: false, memoryPhotosEnabled: true, round: 1, window: 1, revision: 1, candidateManagementLocked: true } });
      if (endpoint === '/candidates') return ok({ candidates: ['king', 'queen'].map((category, index) => ({
        _id: id(index + 30), category, fullName: 'Home', nickname: 'Sign in', bio: 'Your wish', hobbiesAndInterests: ['Account'],
        batchNumber: '2026', isActive: true, images: [`/art/source-${category}.svg`],
      })) });
      if (endpoint === '/images') return ok({ images: [{ _id: id(50), section: 'lantern', title: 'Home', description: 'Your wish', url: '/art/source-king.svg' }] });
      if (endpoint === '/lantern-voting') return ok({ open: true, announced: false, window: 1, winner: null });
      if (endpoint === '/lantern-voting/mine') return ok({ vote: null });
      if (endpoint === '/voting/my-votes') return ok({ votes: [], round: 1, window: 1 });
      if (endpoint === '/wishes/mine') return ok({ used: 0 });
      if (endpoint === '/wishes') return ok({ wishes: [{ id: 'wish-1', message: 'Sign in' }], nextCursor: null, total: 1 });
      if (endpoint === '/memory-photos/mine') return ok({ photos, quota: { limit: 3, acceptedCount: 2, remainingSlots: 1 } });
      if (endpoint === '/memory-photos/like-status') return ok({ photos: [{ photoId: id(1), liked: false }] });
      if (endpoint.endsWith('/image')) return route.fulfill({ contentType: 'image/png', body: png });
      if (endpoint === '/memory-photos') return route.fulfill({ json: { status: 'success', results: 1, pagination: { page: 1, limit: 20, hasMore: false }, data: { photos: [{ id: id(1), likeCount: 2, createdAt: photos[0].createdAt }] } } });
      throw Error(`Unexpected API call ${endpoint}`);
    });

    await page.goto(`${base}/#home`);
    await page.getByRole('heading', { name: /ဆီမီးရောင်စုံ/ }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'my');
    const routes = ['home', 'candidates', 'king', 'queen', 'results', 'lanterns', 'lantern-results', 'wishes', 'entertainment', 'developers', 'privacy', 'account', 'memory-gallery', 'my-memories', 'memory-upload', 'memory-gallery-demo', 'my-memories-demo', 'memory-upload-demo'];
    const layouts = new Map();
    for (const language of ['my', 'en']) {
      for (const route of routes) {
        await page.evaluate(hash => { location.hash = hash; }, route);
        await page.locator('main h1, main h2').first().waitFor();
        if (process.env.LANGUAGE_LAYOUT_AUDIT) {
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const metrics = await collectMetrics(page);
          if (language === 'my') { layouts.set(route, metrics); await checkSpacing(page, width, route); }
          else compareLayouts(metrics, layouts.get(route), width, route);
        }
        assert.match(await page.locator('main').innerText(), language === 'my' ? /[\u1000-\u109f]/ : /[A-Za-z]/, `${route} in ${language}`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow on ${route}, ${width}px, ${language}`);
        const toggle = page.getByRole('button', { name: language === 'my' ? 'Switch to English' : 'မြန်မာဘာသာ ပြောင်းမယ်', exact: true });
        assert(await toggle.isVisible());
        if (width === 390 && ['home', 'candidates', 'wishes', 'memory-upload'].includes(route)) await page.screenshot({ path: `test-artifacts/language/${route}-${language}.png` });
        if (width === 390 && route === 'home') await page.locator('.brand-link').screenshot({ path: `test-artifacts/language/brand-${language}.png` });
      }
      if (language === 'my') await page.getByRole('button', { name: 'Switch to English' }).click();
    }
    await page.reload();
    await page.getByRole('button', { name: 'မြန်မာဘာသာ ပြောင်းမယ်', exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.evaluate(() => localStorage.getItem('festival-language')), 'en');
    if (process.env.LANGUAGE_LAYOUT_AUDIT && await page.locator('.menu-toggle-btn').isVisible()) {
      await page.locator('.menu-toggle-btn').click();
      await compareOpenState(page, width, 'navigation-drawer', 'en');
      await page.keyboard.press('Escape');
    }

    await page.goto(`${base}/#king`);
    await page.getByRole('button', { name: 'Meet Home', exact: true }).click();
    const profile = page.getByRole('dialog');
    await profile.getByRole('heading', { name: 'Home', exact: true }).first().waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'မြန်မာဘာသာ ပြောင်းမယ်', exact: true }).click();
    await page.getByRole('button', { name: translate('Meet Home'), exact: true }).click();
    assert.equal(await page.locator('.profile-copy h2').innerText(), 'Home');
    assert.equal(await page.locator('.biography').innerText(), 'Your wish');
    assert.equal(await page.locator('.chip').innerText(), 'Account');
    await compareOpenState(page, width, 'candidate-dialog');
    await page.keyboard.press('Escape');

    await page.locator('.account-button').click();
    await page.getByLabel('Gmail လိပ်စာ').fill('student@gmail.com');
    await page.getByLabel('စကားဝှက်', { exact: true }).fill('fixture-password');
    // Dialog state also updates when another tab changes the saved language.
    await page.evaluate(() => {
      localStorage.setItem('festival-language', 'en');
      window.dispatchEvent(new StorageEvent('storage', { key: 'festival-language', newValue: 'en' }));
    });
    await page.getByLabel('Gmail address').waitFor();
    await compareOpenState(page, width, 'sign-in-dialog', 'en');
    assert.equal(await page.getByLabel('Gmail address').inputValue(), 'student@gmail.com');
    assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), 'fixture-password');
    if (process.env.LANGUAGE_LAYOUT_AUDIT) {
      await page.getByRole('dialog').locator('.auth-tabs').getByRole('button', { name: 'Register', exact: true }).click();
      await compareOpenState(page, width, 'register-dialog', 'en');
      await page.getByRole('dialog').locator('.auth-tabs').getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('button', { name: 'Forgot password / add a password', exact: true }).click();
      await compareOpenState(page, width, 'recovery-dialog', 'en');
      await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
      await page.getByLabel('Gmail address').fill('student@gmail.com');
      await page.getByLabel('Password', { exact: true }).fill('fixture-password');
    }
    await page.getByRole('dialog').locator('form').getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    if (process.env.LANGUAGE_LAYOUT_AUDIT) {
      await page.goto(`${base}/#king`);
      await page.getByRole('button', { name: 'Meet Home', exact: true }).click();
      await page.getByRole('button', { name: 'Cast your crown', exact: true }).click();
      await page.getByRole('heading', { name: 'Confirm your final choice.', exact: true }).waitFor();
      await compareOpenState(page, width, 'vote-confirmation-dialog', 'en');
      await page.getByRole('button', { name: 'Keep browsing', exact: true }).click();
      await page.keyboard.press('Escape');
    }

    await page.goto(`${base}/#my-memories`);
    await page.getByText('Active photos', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'မြန်မာဘာသာ ပြောင်းမယ်', exact: true }).click();
    await page.getByText(translate('Pending review'), { exact: true }).first().waitFor();
    await page.getByRole('button', { name: translate('Archive'), exact: true }).click();
    await page.getByRole('heading', { name: translate('Archive this memory?'), exact: true }).waitFor();
    await compareOpenState(page, width, 'archive-dialog');
    await page.keyboard.press('Escape');
    await page.goto(`${base}/#memory-upload`);
    await page.getByText(translate('Your active photo allowance'), { exact: true }).waitFor();
    await page.locator('input[type="file"]').first().setInputFiles({ name: 'Home.png', mimeType: 'image/png', buffer: png });
    await page.getByRole('button', { name: 'Switch to English' }).click();
    assert.equal(await page.locator('.mp-slot.is-filled').count(), 1, 'Switching language preserves selected photos');

    await page.goto(`${base}/#wishes`);
    await page.locator('.floating-wish').first().click({ force: true });
    assert.equal(await page.locator('.wish-message').innerText(), 'Sign in', 'Visitor wishes stay untouched');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Release a wish', exact: true }).click();
    await page.getByLabel('Your wish', { exact: true }).fill('My own wish stays exactly as written');
    await page.evaluate(() => {
      localStorage.setItem('festival-language', 'my');
      window.dispatchEvent(new StorageEvent('storage', { key: 'festival-language', newValue: 'my' }));
    });
    assert.equal(await page.locator('#wish-message').inputValue(), 'My own wish stays exactly as written');
    await compareOpenState(page, width, 'wish-compose-dialog');
    await page.keyboard.press('Escape');
    await page.goto(`${base}/#developers`);
    await page.locator('.dev-team-orb').first().click();
    await page.locator('.dev-team-members > button').first().click();
    await page.locator('.dev-solo').waitFor();
    await compareOpenState(page, width, 'developer-dialog');
    await page.keyboard.press('Escape');
    await context.close();
    console.log(`PASS: all public routes, language persistence, dialogs, unchanged content and drafts at ${width}px`);
  }
  assert.deepEqual(errors, []);
  if (process.env.LANGUAGE_LAYOUT_AUDIT) {
    await writeFile('test-artifacts/language/layout-audit.json', JSON.stringify(measurements, null, 2));
    // Burmese may use extra vertical leading and separation to accommodate its
    // stacked marks; keep the same line counts and horizontal layout.
    const overflows = measurements.filter(({ english, my }) => my.rows > english.rows || my.width > english.width + 2);
    const crowded = spacingChecks.filter(check => check.gap < check.minimum - .5);
    await writeFile('test-artifacts/language/spacing-audit.json', JSON.stringify(spacingChecks, null, 2));
    console.log(`Layout comparison: ${measurements.length} text blocks, ${overflows.length} extra lines or wider blocks; ${spacingChecks.length} spacing checks, ${crowded.length} crowded pairs`);
    if (process.env.LANGUAGE_LAYOUT_ASSERT) assert.deepEqual(overflows, []);
    if (process.env.LANGUAGE_LAYOUT_ASSERT) assert.deepEqual(crowded, []);
  }
} finally {
  if (process.env.LANGUAGE_LAYOUT_AUDIT) await writeFile('test-artifacts/language/layout-audit.json', JSON.stringify(measurements, null, 2));
  if (process.env.LANGUAGE_LAYOUT_AUDIT) await writeFile('test-artifacts/language/spacing-audit.json', JSON.stringify(spacingChecks, null, 2));
  await browser.close();
  await server.close();
}
