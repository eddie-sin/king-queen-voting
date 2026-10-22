// Browser → Vite proxy → Express → temporary MongoDB → browser.
// Requires a local mongod binary; never uses the database in config.env.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});
const listen = server => new Promise(resolve => server.once('listening', resolve));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.ADMIN_USERNAME = 'wish-browser-admin';
process.env.ADMIN_PASSWORD = randomBytes(20).toString('hex');
delete process.env.WISH_SKY_EVENT_DATE;
const User = require('../../model/usersModel.js');
const Wish = require('../../model/wishesModel.js');
const app = require('../../app.js');
const { seed } = require('../../utils/seed.js');

let mongo;
let apiServer;
let vite;
let browser;
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wish-live-browser-'));
try {
  const mongoPort = await freePort();
  mongo = spawn(process.env.MONGOD_BINARY || 'mongod', [
    '--bind_ip', '127.0.0.1', '--port', String(mongoPort),
    '--dbpath', tempDir, '--logpath', path.join(tempDir, 'mongod.log'),
  ], { stdio: 'ignore' });
  for (let attempt = 0; ; attempt++) {
    try {
      await mongoose.connect(`mongodb://127.0.0.1:${mongoPort}/wish_browser_test`, { serverSelectionTimeoutMS: 300 });
      break;
    } catch (error) {
      if (attempt >= 40 || mongo.exitCode !== null) throw new Error(`Temporary MongoDB did not start: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  await seed();
  await User.create({ email: 'wish-browser@example.test', passwordHash: await bcrypt.hash('festival123', 10), status: 'active' });
  apiServer = app.listen(0, '127.0.0.1');
  await listen(apiServer);
  process.env.VOTING_API_TARGET = `http://127.0.0.1:${apiServer.address().port}`;
  vite = await createServer({ configFile: 'vite.config.js', mode: 'development', server: { host: '127.0.0.1', port: 0 } });
  await vite.listen();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  await page.goto(`${base}/#wishes`);
  await page.getByText('The sky is waiting for its first wish.').waitFor();
  await page.getByRole('button', { name: 'Release a wish' }).click();
  const login = page.getByRole('dialog');
  await login.getByLabel('Email address').fill('wish-browser@example.test');
  await login.getByLabel('Password', { exact: true }).fill('festival123');
  await login.getByRole('button', { name: 'Login', exact: true }).last().click();
  await page.getByRole('heading', { name: 'Send a little hope.' }).waitFor();
  await page.getByLabel('Your wish', { exact: true }).fill('A wish saved through the real API');
  await page.getByRole('button', { name: 'Release my lantern' }).click();
  await page.getByText('2 of 3 wishes remaining', { exact: true }).waitFor();
  assert.equal(await Wish.countDocuments(), 1);
  await page.reload();
  await page.getByRole('button', { name: 'Read wish 1', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Read wish 1', exact: true }).click();
  await page.getByRole('dialog').getByText('A wish saved through the real API').waitFor();
  assert.deepEqual(errors, []);
  console.log('Wish Sky live flow passed: browser → API → MongoDB → browser.');
} finally {
  if (browser) await browser.close();
  if (vite) await vite.close();
  if (apiServer) await new Promise(resolve => apiServer.close(resolve));
  await mongoose.disconnect();
  if (mongo && mongo.exitCode === null) {
    const exited = new Promise(resolve => mongo.once('exit', resolve));
    mongo.kill('SIGTERM');
    await exited;
  }
  await rm(tempDir, { recursive: true, force: true });
}
