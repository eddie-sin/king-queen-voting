import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.js', server: { host: '127.0.0.1', port: 0, strictPort: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  for (const scenario of [
    { width: 1440, reducedMotion: 'no-preference', bursts: 4 },
    { width: 390, reducedMotion: 'no-preference', bursts: 2 },
    { width: 390, reducedMotion: 'reduce', bursts: 2 },
    { width: 390, reducedMotion: 'no-preference', bursts: 2, failAudio: true },
  ]) {
    const page = await browser.newPage({ viewport: { width: scenario.width, height: 900 }, reducedMotion: scenario.reducedMotion });
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.addInitScript(() => {
      window.soundEvents = [];
      window.audioClosed = false;
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function(when, offset, duration) {
        window.soundEvents.push({ when, duration, bufferDuration: this.buffer.duration, state: this.context.state });
        return start.call(this, when, offset, duration);
      };
      const close = AudioContext.prototype.close;
      AudioContext.prototype.close = function() { window.audioClosed = true; return close.call(this); };
    });
    if (scenario.failAudio) await page.route('**/sounds/*.wav', route => route.fulfill({ status: 404, body: '' }));
    await page.route(`${base}/firework-audio-check`, route => route.fulfill({ contentType: 'text/html', body: `
      <div id="root"></div><script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import FireworkStation from '/src/wishes/FireworkStation.jsx';
      window.root = ReactDOM.createRoot(document.getElementById('root'));
      window.root.render(React.createElement(FireworkStation));
      </script>` }));
    await page.goto(`${base}/firework-audio-check`);
    const button = page.getByRole('button', { name: 'Launch fireworks' });
    await button.waitFor();
    assert.equal(await page.evaluate(() => soundEvents.length), 0, 'Loading the page must not play sound');
    await button.click();
    await page.locator('.firework-canvas').waitFor({ state: 'attached' });
    const bursts = JSON.parse(await page.locator('.firework-canvas').getAttribute('data-bursts'));
    assert.equal(bursts.length, scenario.bursts);
    const events = await page.evaluate(() => soundEvents);
    const reduced = scenario.reducedMotion === 'reduce';
    const soundsPerLaunch = scenario.failAudio ? 0 : reduced ? 1 : 2;
    assert.equal(events.length, soundsPerLaunch, 'Each clip should play once per click, regardless of rocket count');
    if (!scenario.failAudio) {
      const started = events[0].when;
      const explosion = events[reduced ? 0 : 1];
      // The supplied second recording is 144382 frames at 44100 Hz.
      assert.ok(Math.abs(explosion.bufferDuration - 144382 / 44100) < .001);
      assert.ok(Math.abs(explosion.when - started - (reduced ? 0 : .9)) < .001);
      assert.equal(explosion.state, 'running', 'Click must unlock real browser audio');
      if (!reduced) {
        const launch = events[0];
        assert.ok(Math.abs(launch.bufferDuration - 145592 / 44100) < .001, 'Launch must use the first recording');
        assert.equal(launch.duration, .9, 'Launch audio must end with the rocket flight');
        assert.ok(Math.abs(explosion.when - launch.when - .9) < .001);
      }
    }
    await button.click();
    await page.waitForFunction(expected => JSON.parse(document.querySelector('.firework-canvas').dataset.bursts).length === expected, scenario.bursts * 2);
    assert.equal(await page.evaluate(() => soundEvents.length), soundsPerLaunch * 2, 'A second click should add exactly one more playback of each clip');
    await page.evaluate(() => root.unmount());
    assert.equal(await page.evaluate(() => audioClosed), true, 'Leaving the page must close its audio context');
    await page.waitForTimeout(100);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Firework audio passed: real WAV decoding, desktop/mobile timing, reduced motion, overlapping launches, missing audio and cleanup.');
} finally {
  await browser?.close();
  await server.close();
}
