// Optional preview capture. Uses only the explicitly labelled development fixtures.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const server=await createServer({configFile:'vite.config.js',mode:'fixtures',server:{host:'127.0.0.1',port:0}});
await server.listen();
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox']});
const destination=new URL('../test-artifacts/',import.meta.url);await mkdir(destination,{recursive:true});
try {
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
  const page=await browser.newPage({viewport,reducedMotion:'reduce'});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByRole('button',{name:'View profile'}).first().waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:new URL(`${name}.png`,destination).pathname,fullPage:true});
  await page.getByRole('button',{name:'View profile'}).first().click();
  await page.getByRole('dialog').waitFor();
  await page.screenshot({path:new URL(`${name}-profile.png`,destination).pathname});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error(`${name} horizontal overflow`);
  await page.close();
 }
 console.log('Captured desktop and mobile fixture previews, including profile dialogs.');
}finally{await browser.close();await server.close();}
