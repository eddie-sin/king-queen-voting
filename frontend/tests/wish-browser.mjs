import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.js', mode: 'development', server: { host: '127.0.0.1', port: 0, strictPort: false } });
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
    let signedIn = false, used = 0, failMine = viewport.width === 1440, failReaction = viewport.width === 1440;
    const ownWishes = [];
    const reactions = new Map();
    await page.route('**/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname;
      const ok = data => route.fulfill({ json: { status: 'success', data } });
      if (path.endsWith('/wishes/status')) return ok({wishSky:{isOpen:true,moderationRevision:0}});
      if (path.endsWith('/config')) return ok({ csrfToken: 'wish-browser-csrf', googleClientId: null });
      if (path.endsWith('/pending')) return ok({ flow: null });
      if (path.endsWith('/login')) { signedIn = true; return ok({ sessionKey: 'wish-browser-session', user: { id: 'wish-user', email: 'demo@gmail.com', round: 1 } }); }
      if (path.endsWith('/me')) return signedIn ? ok({ sessionKey: 'wish-browser-session', user: { id: 'wish-user', email: 'demo@gmail.com', round: 1 } }) : route.fulfill({ status: 401, json: { status: 'fail', message: 'Sign in to continue.' } });
      if (path.endsWith('/logout')) { signedIn = false; return ok({}); }
      if (path.endsWith('/wishes/mine')) return ok({ used, remaining: Math.max(0, 3 - used) });
      if (path.endsWith('/wishes/mine/wishes')) {
        if (failMine) { failMine = false; return route.fulfill({ status: 503, json: { status: 'error', message: 'Try again.' } }); }
        return ok({ wishes: [...ownWishes].reverse() });
      }
      if (path.endsWith('/reaction')) {
        if (failReaction) { failReaction = false; return route.fulfill({ status: 503, json: { status: 'error', message: 'Try again.' } }); }
        const id = path.split('/').at(-2);
        const active = route.request().postDataJSON().active;
        reactions.set(id, active);
        return ok({ reactions: active ? 1 : 0, reacted: active });
      }
      if (path.endsWith('/wishes') && route.request().method() === 'POST') {
        if (used >= 3) return route.fulfill({ status: 409, json: { status: 'fail', message: 'Wish limit reached.' } });
        used++; const { message, name } = route.request().postDataJSON(); const wish = { id: `created-${used}`, message, ...(name ? { name } : {}) }; ownWishes.push(wish); return ok({ wish });
      }
      if (path.endsWith('/wishes')) return ok({ wishes: Array.from({ length: 24 }, (_, index) => ({ id: `wish-${index + 1}`, message: `Festival wish ${index + 1}`, reactions: reactions.get(`wish-${index + 1}`) ? 1 : 0, reacted: reactions.get(`wish-${index + 1}`) || false })), nextCursor: null, total: 24 });
      if (path.endsWith('/voting/my-votes')) return ok({ votes: [], round: 1, window: 1 });
      if (path.endsWith('/settings')) return ok({ controls: { registrationOpen: true, votingStatus: 'closed', announcementOpen: false, memoryPhotosEnabled: false, round: 1, window: 1, revision: 0, candidateManagementLocked: false } });
      if (path.endsWith('/lantern-voting')) return ok({ open: false, announced: false, window: 0, winner: null });
      if (path.endsWith('/candidates')) return ok({ candidates: [] });
      if (path.endsWith('/images')) return ok({ images: [] });
      throw Error(`Unexpected API request: ${path}`);
    });
    await page.goto(`${base}/#wishes`);
    await page.getByRole('tab',{name:/^Sign in/}).click();
    const initialLogin=page.locator('dialog.account-dialog');
    await initialLogin.getByLabel('Gmail address').fill('demo@gmail.com');
    await initialLogin.getByLabel('Password',{exact:true}).fill('festival123');
    await initialLogin.locator('form').getByRole('button',{name:'Sign in',exact:true}).click();
    await initialLogin.waitFor({state:'detached'});

    await page.locator('.floating-wish').first().waitFor();
    await page.getByRole('heading', { name: 'Read a wish' }).waitFor();
    const spotlight = await page.locator('.wish-tour-spotlight').boundingBox();
    assert.ok(spotlight.width > 40 && spotlight.height > 40);
    assert.equal(await page.locator('dialog.account-dialog').count(), 0);
    assert.equal(await page.locator('.wish-quota-note').innerText(), '3/3');
    assert.equal(await page.getByText('The sky is waiting for its first wish.').count(), 0);
    if (viewport.width === 768) {
      await page.mouse.click(spotlight.x + spotlight.width / 2, spotlight.y + spotlight.height / 2);
      await page.getByRole('dialog').locator('.wish-message').waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('heading', { name: 'Play or pause' }).waitFor();
      await page.locator('.music-player-play').click({ force: true });
      await page.getByRole('heading', { name: 'Adjust the volume' }).waitFor();
      await page.locator('.music-player-volume').click({ force: true });
      await page.getByRole('heading', { name: 'Light up the sky' }).waitFor();
      await page.getByRole('button', { name: 'Launch fireworks' }).click();
      await page.getByRole('heading', { name: 'Release your wish' }).waitFor();
      await page.getByRole('button', { name: 'Finish' }).click();
      await page.reload();
      assert.equal(await page.locator('.wish-tour-card').count(), 0, 'The completed tour should stay dismissed');
    } else {
      await page.getByRole('button', { name: 'Skip tutorial' }).click();
      await page.reload();
      assert.equal(await page.locator('.wish-tour-card').count(), 0, 'The skipped tour should stay dismissed');
    }
    assert.equal(await page.locator('.wish-tour-card').count(), 0);
    assert.equal(await page.locator('.sky-actions .firework-station').count(), 0);
    assert.equal(await page.locator('.firework-station .firework-stick:visible').count(), viewport.width < 580 ? 2 : 5);
    await page.getByRole('button', { name: 'Launch fireworks' }).click();
    await page.locator('.firework-canvas').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.firework-display').evaluate(element => Math.round(element.getBoundingClientRect().width)), viewport.width);
    const firstBursts = JSON.parse(await page.locator('.firework-canvas').getAttribute('data-bursts'));
    const ordinary = ['round', 'chrysanthemum', 'willow'];
    assert.equal(firstBursts.length, 4);
    assert.ok(firstBursts.filter(burst => ordinary.includes(burst.shape)).length >= 3, 'Ordinary fireworks should dominate the show');
    assert.ok(firstBursts.every(burst => [...ordinary, 'butterfly', 'flower', 'heart', 'star'].includes(burst.shape)));
    await page.waitForTimeout(1800);
    assert.deepEqual(errors, [], 'The firework renderer should run without browser errors');
    const pixels = () => page.locator('.firework-canvas').evaluate(canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0; for (let index = 3; index < data.length; index += 4) if (data[index] > 20) lit++;
      return lit;
    });
    assert.ok(await pixels() > 150, 'The fireworks should visibly draw their shapes');
    if (reducedMotion === 'reduce') {
      const before = await pixels();
      await page.waitForTimeout(150);
      assert.equal(await pixels(), before, 'Reduced motion should show stationary spark shapes');
    }
    await page.getByRole('button', { name: 'Launch fireworks' }).click();
    const nextBursts = JSON.parse(await page.locator('.firework-canvas').getAttribute('data-bursts'));
    assert.notDeepEqual(nextBursts.map(burst => [burst.x, burst.y]), firstBursts.map(burst => [burst.x, burst.y]), 'Each launch should change burst positions');
    if (viewport.width < 580) assert.equal(await page.getByRole('heading', { name: /A sky full of/ }).isVisible(), false);
    assert.equal(await page.locator('.floating-wish').count(), viewport.width < 580 ? 8 : 24);
    assert.equal(await page.locator('.floating-wish .wish-lantern-shape').first().evaluate(element => parseFloat(getComputedStyle(element).width)), 60);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const releaseButton = await page.getByRole('button', { name: 'Release a wish' }).boundingBox();
    const quotaNote = page.locator('.wish-quota-note');
    const noteBox = await quotaNote.boundingBox();
    const actionsBox = await page.locator('.sky-actions').boundingBox();
    const stationBox = await page.locator('.firework-station').boundingBox();
    assert.ok(stationBox.x + stationBox.width <= actionsBox.x || stationBox.x >= actionsBox.x + actionsBox.width || stationBox.y + stationBox.height <= actionsBox.y || stationBox.y >= actionsBox.y + actionsBox.height, 'Firework sticks should sit outside the release controls');
    if (viewport.width < 580) {
      const musicBox = await page.locator('.music-player').boundingBox();
      assert.ok(actionsBox.x + actionsBox.width <= stationBox.x && stationBox.x + stationBox.width <= musicBox.x, 'Mobile controls should sit side by side: release, fireworks, music');
      assert.ok(Math.abs(actionsBox.y + actionsBox.height - stationBox.y - stationBox.height) < 2 && Math.abs(stationBox.y + stationBox.height - musicBox.y - musicBox.height) < 2, 'The mobile controls should share one bottom row');
      assert.ok(musicBox.x + musicBox.width <= viewport.width - 8);
      assert.ok(releaseButton.height >= 44);
    }
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
    await page.getByRole('button', { name: 'React to wish' }).click();
    if (viewport.width === 1440) {
      await page.getByRole('dialog').getByRole('alert').waitFor();
      assert.equal(await page.locator('.wish-reaction-burst').count(), 0, 'A failed reaction should not celebrate');
      await page.getByRole('button', { name: 'React to wish' }).click();
    }
    await page.getByRole('button', { name: 'Remove reaction' }).waitFor();
    await page.locator('.wish-reaction-burst').waitFor();
    if (reducedMotion === 'reduce') assert.equal(await page.locator('.wish-reaction-burst').evaluate(element => getComputedStyle(element).transform), 'none');
    assert.equal(await page.locator('dialog.account-dialog').count(), 0);
    await page.getByRole('button', { name: 'Remove reaction' }).click();
    await page.getByRole('button', { name: 'React to wish' }).waitFor();
    await page.locator('.wish-reaction-burst').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: /see more wishes|read another wish/i }).count(), 0);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    assert.equal(await firstWish.evaluate(element => document.activeElement === element), true);
    await firstWish.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').locator('.wish-message').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await firstWish.evaluate(element => document.activeElement === element), true);
    await page.getByRole('button', { name: 'Release a wish' }).click();
  if (!await page.getByRole('heading', { name: 'Send a little hope.' }).count()) await page.getByRole('button', { name: 'Release a wish' }).click();
    await page.getByRole('heading', { name: 'Send a little hope.' }).waitFor();
    for (let index = 1; index <= 3; index++) {
      await page.getByLabel('Your wish', { exact: true }).fill(index === 1 ? 'a'.repeat(280) : `Wish ${index}`);
      if (index === 1) await page.getByLabel('Your name').fill('Aye');
      if (index === 1) assert.equal((await page.getByLabel('Your wish', { exact: true }).inputValue()).length, 280);
      await page.getByRole('button', { name: 'Release my lantern' }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByText(`${3 - index}/3`, { exact: true }).waitFor();
      assert.equal(await page.getByText('Your lantern is rising gently. Your wish has joined the sky.', { exact: true }).count(), 0);
      if (index === 1) {
        await page.getByRole('button', { name: 'Read your released wish' }).waitFor();
        const released = page.getByRole('button', { name: 'Read your released wish' });
        assert.equal(await page.locator('.newly-released-wish').count(), 1, 'Only one lantern should represent the released wish');
        assert.equal(await page.locator('.released-lantern').count(), 0, 'There should be no separate release lantern');
        if (reducedMotion === 'no-preference') {
          assert.equal(await released.isDisabled(), true);
          const motion = await released.evaluate(element => {
            element.dataset.continuousFlight = 'true';
            const animation = element.getAnimations().find(item => item.animationName === 'released-wish-flight');
            const arrival = element.getAnimations().find(item => item.animationName === 'release-arrival');
            animation.id = 'continuous-release';
            animation.pause(); arrival.pause();
            const sample = time => {
              animation.currentTime = time;
              const transform = new DOMMatrix(getComputedStyle(element).transform);
              return { y: transform.m42, scale: transform.m11 };
            };
            const early = sample(1500), middle = sample(7000), late = sample(12500);
            animation.currentTime = 2500;
            return { early, middle, late, duration: animation.effect.getTiming().duration };
          });
          assert.equal(motion.duration, 14500, 'Restore the earlier 14.5-second release');
          assert.ok(motion.early.y > motion.middle.y && motion.middle.y > motion.late.y, 'The lantern should keep rising across the sky');
          assert.ok(motion.early.scale > motion.middle.scale && motion.middle.scale > motion.late.scale, 'The lantern should shrink into the distance');
          const inFlight = await released.boundingBox();
          assert.ok(inFlight.y > viewport.height * .5, 'The single lantern should still be rising during the release');
          const arrivalTop = await released.evaluate(element => {
            const animation = element.getAnimations().find(item => item.animationName === 'released-wish-flight');
            const arrival = element.getAnimations().find(item => item.animationName === 'release-arrival');
            animation.currentTime = arrival.effect.getTiming().duration;
            const top = element.getBoundingClientRect().top;
            arrival.finish();
            return top;
          });
          await page.waitForFunction(() => !document.querySelector('.newly-released-wish')?.disabled);
          assert.equal(await released.getAttribute('data-continuous-flight'), 'true', 'The same lantern should remain after arrival');
          const arrived = await released.boundingBox();
          assert.ok(Math.abs(arrived.y - arrivalTop) < 12, 'The lantern should continue from its arrival point without restarting at the bottom');
          assert.ok(arrived.y <= viewport.height * .51);
          assert.equal(await released.evaluate(element => element.getAnimations().some(animation => animation.id === 'continuous-release')), true, 'The same flight should keep running after arrival');
          assert.equal(await page.locator('.wish-release').count(), 0);
          await released.evaluate(element => element.getAnimations().find(animation => animation.animationName === 'released-wish-flight').finish());
          await page.locator('.newly-released-wish.is-in-sky').waitFor();
          await page.keyboard.press('Tab');
          await released.focus();
          assert.equal(await released.evaluate(element => getComputedStyle(element).animationPlayState), 'running', 'The returning lantern must keep moving when focus returns to it');
          const beforeFocusRise = await released.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m42);
          await page.waitForTimeout(250);
          const afterFocusRise = await released.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m42);
          assert.ok(afterFocusRise < beforeFocusRise - 1, 'The returning lantern must actually rise instead of freezing near the bottom');
          await released.evaluate(element => element.blur());
          for (const cycle of [.4, 1.4]) {
            await released.evaluate((element, cycle) => {
              const animation = element.getAnimations().find(animation => animation.animationName === 'wish-natural-rise');
              animation.pause(); animation.currentTime = animation.effect.getTiming().duration * cycle;
            }, cycle);
            const returning = await released.locator('.wish-lantern-shape').boundingBox();
            assert.ok(returning.y > 80 && returning.y + returning.height < viewport.height, 'The released wish should keep returning visibly after its launch');
            assert.equal(await released.getAttribute('data-continuous-flight'), 'true');
            assert.equal(await page.locator('.newly-released-wish').count(), 1, 'The returning wish should still have only one lantern');
          }
        }
        assert.equal(await released.getByText('Your wish', { exact: true }).count(), 0, 'The lantern should have no visible label');
        const releasedBox = await released.locator('.wish-lantern-shape').boundingBox();
        await page.mouse.click(releasedBox.x + releasedBox.width / 2, releasedBox.y + releasedBox.height / 2);
        await page.getByRole('dialog').getByText('Aye').waitFor();
        await page.keyboard.press('Escape');
      }
      if (index < 3) await page.getByRole('button', { name: 'Release a wish' }).click();
    }
    await page.getByRole('button', { name: 'Release a wish' }).click();
    assert.equal(await page.getByRole('button', { name: 'Release my lantern' }).isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Account and my choices', exact: true }).click();
    await page.getByRole('link', { name: 'My wishes', exact: true }).click();
    await page.getByRole('heading', { name: 'My wishes.' }).waitFor();
    if (viewport.width === 1440) { await page.locator('.my-wishes-page').getByRole('alert').waitFor(); await page.getByRole('button', { name: 'Try again', exact: true }).click(); }
    await page.getByRole('article', { name: 'Your wish 1', exact: true }).waitFor();
    assert.equal(await page.locator('.my-wish-card').count(), 3);
    assert.equal(await page.locator('.my-wish-message').first().innerText(), 'Wish 3');
    assert.equal(await page.locator('.my-wish-message').last().innerText(), 'a'.repeat(280));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('wish-sky-tour-v1')), 'done');
    await page.getByRole('link', { name: 'See tutorial', exact: true }).click();
    await page.getByRole('heading', { name: 'Read a wish', exact: true }).waitFor();
    assert.equal(await page.locator('.wish-tour-progress').innerText(), '1 / 5');
    if (viewport.width === 1440) {
      for (const title of ['Play or pause', 'Adjust the volume', 'Light up the sky', 'Release your wish']) {
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await page.getByRole('heading', { name: title, exact: true }).waitFor();
      }
      await page.getByRole('button', { name: 'Finish', exact: true }).click();
    } else await page.getByRole('button', { name: 'Skip tutorial', exact: true }).click();
    await page.reload();
    await page.locator('.floating-wish').first().waitFor();
    assert.equal(await page.locator('.wish-tour-card').count(), 0, 'A finished or skipped replay should stay dismissed on normal visits');
    await page.evaluate(() => { location.hash = 'my-wishes'; });
    await page.getByRole('heading', { name: 'My wishes.' }).waitFor();
    await page.getByRole('link', { name: 'Back to account', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.evaluate(() => { location.hash = 'my-wishes'; });
    await page.getByRole('tab',{name:/^Sign in/}).waitFor();
    assert.equal(await page.locator('.my-wish-card').count(), 0, 'Signing out must clear the account wishes');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Wish Sky browser flow passed on desktop, tablet, mobile, 320px and reduced motion.');
} finally {
  await browser.close();
  await server.close();
}
