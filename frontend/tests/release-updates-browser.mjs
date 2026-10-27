// Isolated release changes: no real accounts, database, emails or AWS.
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const server = await createServer({ configFile:false, server:{host:'127.0.0.1',port:0} });
await server.listen();
const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
const oldHTML='<!doctype html><div id="root">old version</div><script type="module" src="/assets/old.js"></script>';
const newHTML=oldHTML.replaceAll('old','new');
const advance=async (page,ms)=>{await page.clock.fastForward(ms);await new Promise(resolve=>setTimeout(resolve,150));};
let browser;
try {
 for(const engine of ['chromium','webkit']){
  const executablePath=engine==='chromium' && process.platform==='darwin' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined;
  browser=await (engine==='chromium'?chromium:webkit).launch({headless:true,...(executablePath?{executablePath}:{})});
  for(const width of [1440,390]){
   async function setup(hash='privacy',automatic=true){
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
    const state={html:oldHTML,status:200,checks:0};
    await page.clock.install();
    await page.route('**/assets/*.js',route=>route.fulfill({contentType:'text/javascript',body:''}));
    await page.route('**/index.html*',route=>{
     if(new URL(route.request().url()).searchParams.has('_check'))state.checks++;
     return route.fulfill({status:state.status,contentType:'text/html',body:state.html});
    });
    await page.goto(`${origin}/index.html#${hash}`);
    await page.evaluate(async automatic=>{const {startReleaseUpdates}=await import('/src/releaseUpdates.js');window.stopUpdates=startReleaseUpdates({automatic,interval:60000});},automatic);
    return {page,context,state};
   }
   {
    const {page,context,state}=await setup();
    await advance(page,6100);assert.equal(state.checks,1);assert.equal(new URL(page.url()).searchParams.has('_release'),false);
    state.html=newHTML;
    const next=page.waitForURL(url=>url.searchParams.has('_release'));
    await advance(page,60000);await next;
    assert.equal(new URL(page.url()).hash,'#privacy');assert.match(await page.locator('#root').innerText(),/new/);
    await context.close();
   }
   {
    const {page,context,state}=await setup('home');
    await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.innerHTML='<form><input aria-label="Email" value="unfinished@gmail.com"></form>';document.body.append(dialog);dialog.showModal();});
    state.html=newHTML;await advance(page,6100);
    await page.getByRole('button',{name:'Update now'}).waitFor();
    assert.equal(new URL(page.url()).searchParams.has('_release'),false);
    assert.equal(await page.getByRole('textbox',{name:'Email'}).inputValue(),'unfinished@gmail.com');
    await page.evaluate(()=>document.querySelector('dialog').close());
    const next=page.waitForURL(url=>url.searchParams.has('_release'));await advance(page,2100);await next;
    await context.close();
   }
   {
    const {page,context,state}=await setup('memory-submit');state.html=newHTML;await advance(page,6100);
    await page.getByRole('button',{name:'Update now'}).waitFor();
    await advance(page,120000);assert.equal(new URL(page.url()).searchParams.has('_release'),false);
    const next=page.waitForURL(url=>url.searchParams.has('_release'));await page.getByRole('button',{name:'Update now'}).click();await next;
    assert.equal(new URL(page.url()).hash,'#memory-submit');await context.close();
   }
   {
    const {page,context,state}=await setup('privacy',false);state.status=503;
    await advance(page,6100);assert.equal(await page.getByRole('button',{name:'Update now'}).count(),0);
    state.status=200;state.html='<html>Invalid login or error page</html>';
    await advance(page,60000);assert.equal(await page.getByRole('button',{name:'Update now'}).count(),0);
    state.html=newHTML;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByRole('button',{name:'Update now'}).waitFor();await advance(page,120000);
    assert.equal(new URL(page.url()).searchParams.has('_release'),false,'Staff pages must never auto-reload');
    await page.evaluate(()=>window.stopUpdates());assert.equal(await page.getByRole('button',{name:'Update now'}).count(),0);
    await context.close();
   }
   console.log(`${engine} ${width}: stale release replaced, hash preserved, forms protected, explicit update, invalid responses ignored, staff not interrupted`);
  }
  await browser.close();browser=null;
 }
}finally{await browser?.close();await server.close();}
