// Local disposable database and generated accounts only. Never load config.env.
const assert=require('node:assert/strict');
const {createV2Fixture}=require('../test/fixtures/v2Fixture.cjs');
const {chromium}=require('../frontend/node_modules/playwright');
(async()=>{
 const fixture=await createV2Fixture();let vite,browser;
 try{
  await fixture.reset();
  const {createServer}=await import('../admin/node_modules/vite/dist/node/index.js');
  vite=await createServer({root:require('node:path').resolve(__dirname,'../admin'),server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:fixture.baseUrl,changeOrigin:true}}}});await vite.listen();
  browser=await chromium.launch(process.env.CI?{headless:true}:{channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+vite.httpServer.address().port);
  await page.getByLabel('Admin username').fill('v2-root');await page.getByLabel('Password',{exact:true}).fill(fixture.password);
  await page.getByRole('button',{name:'Enter admin workspace →'}).click();
  await page.getByRole('button',{name:'Wish Sky',exact:true}).click();await page.getByRole('heading',{name:'Wish Sky moderation'}).waitFor();
  await page.getByRole('button',{name:'Pause new wishes'}).click();await page.getByRole('button',{name:'Resume new wishes'}).waitFor();
  await page.getByRole('button',{name:'Resume new wishes'}).click();await page.getByRole('button',{name:'Pause new wishes'}).waitFor();
  await page.getByRole('button',{name:'Account security',exact:true}).click();
  await page.getByLabel('Current password',{exact:true}).fill(fixture.password);
  await page.getByLabel('New password',{exact:true}).fill('A locally generated test passphrase');
  await page.getByLabel('Confirm new password',{exact:true}).fill('A locally generated test passphrase');
  await page.getByRole('button',{name:'Change password and sign out'}).click();await page.getByRole('button',{name:'Enter admin workspace →'}).waitFor();
  await page.getByLabel('Admin username').fill('v2-root');await page.getByLabel('Password',{exact:true}).fill('A locally generated test passphrase');await page.getByRole('button',{name:'Enter admin workspace →'}).click();
  await page.getByRole('button',{name:'Account security',exact:true}).waitFor();assert.deepEqual(errors,[]);
  console.log('Staff security browser passed: wish controls, password change, session invalidation and sign-in. Disposable local data only.');
 }finally{await browser?.close();await vite?.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
