import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const server=await createServer({mode:'fixtures',server:{host:'127.0.0.1',port:0}});await server.listen();
const browser=await chromium.launch({headless:true, channel: process.env.PLAYWRIGHT_CHANNEL || "msedge"});
try {
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/#home`);
await page.getByRole('link',{name:'Meet the developers'}).click();await page.locator('.dev-portrait').first().waitFor();
assert.equal(await page.locator('.dev-portrait').count(),11);assert.equal(await page.locator('.site-nav a[href="#developers"]').count(),0);
await page.screenshot({path:join(tmpdir(),'developers-desktop.png'),fullPage:true});
for(let i=0;i<11;i++){await page.locator('.dev-portrait').nth(i).click({force:true});await page.locator('.dev-dialog[open] .dev-solo').waitFor();assert.equal(await page.evaluate(()=>location.hash),'#developers');await page.keyboard.press('Escape');await page.locator('.dev-dialog').waitFor({state:'hidden'});assert.ok(await page.locator('.dev-portrait').nth(i).evaluate(el=>el===document.activeElement));}
for(let i=0;i<5;i++){await page.locator('.dev-team-orb').nth(i).click();assert.equal(await page.locator('.dev-team-members>button').count(),[4,4,3,5,2][i]);await page.locator('.dev-team-members>button').first().click();await page.getByRole('button',{name:/Back to team/}).click();await page.getByRole('button',{name:/Back to everyone/}).click();await page.locator('.dev-dialog').waitFor({state:'hidden'});}
await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(tmpdir(),'developers-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.locator('.dev-team-orb').nth(3).click();await page.screenshot({path:join(tmpdir(),'developers-team-mobile.png'),fullPage:true});await page.locator('.dev-team-members>button').first().click();await page.screenshot({path:join(tmpdir(),'developers-solo-mobile.png'),fullPage:true});await page.keyboard.press('Escape');await page.locator('.dev-dialog').waitFor({state:'hidden'});
await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.dev-portrait').first().click({force:true});await page.keyboard.press('Escape');await page.locator('.dev-dialog').waitFor({state:'hidden'});assert.deepEqual(errors,[]);
console.log('Passed: Home link, all profiles and teams, team return, Escape, focus restoration, mobile overflow, reduced motion, no runtime errors.');
}finally{await browser.close();await server.close();}





