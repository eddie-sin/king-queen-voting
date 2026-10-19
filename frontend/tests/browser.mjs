/* Real API adapter + real browser, with HTTP responses intercepted locally.
   Starts its own local Vite server: npm run test:browser
   No network calls reach an event backend. All identities and keys below are fixtures. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = process.env.TEST_BASE_URL ? null : await createServer({ configFile: 'vite.config.js', mode: 'development', server: { host: '127.0.0.1', port: 0 } });
if (server) await server.listen();
const base = process.env.TEST_BASE_URL || `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
const key = 'a'.repeat(64);
const data = ['king','queen'].flatMap(contest => [1,2,3].map(i => ({
  _id: `${contest}-${i}`, fullName: `${contest === 'king' ? 'Aung' : 'May'} Sample ${i}`, category: contest,
  batchNumber: '2026', isActive: true, images: Array.from({length:i}, () => `/art/royal-${contest}.svg`),
  ...(i === 1 ? {bio:'A sample biography.', nickname:'Sample', age:20, zodiacSign:'Libra', hobbiesAndInterests:['Music']} : {}),
  contactNumber:'PRIVATE_CONTACT_MUST_NOT_RENDER',
})));
function backend() {
  return { votes:{}, authenticated:false, expired:false, disabled:false, candidateError:false, empty:false, registrationClosed:false, phase:'open', settingsError:false, dropMutation:false, failReads:false, mutations:[], reads:0, registrations:0, meCalls:0 };
}
async function setup(state, viewport={width:1440,height:1000}) {
  const context=await browser.newContext({viewport, reducedMotion:'reduce'});
  const page=await context.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/**', async route=>{
    const req=route.request(), path=new URL(req.url()).pathname.replace('/api/v1','');
    const body=req.postDataJSON();
    const ok=data=>route.fulfill({json:{status:'success',data}});
    const fail=(status,message)=>route.fulfill({status,json:{status:'fail',message}});
    if(path==='/candidates') return state.candidateError?fail(503,'Sample service unavailable'):ok({candidates:state.empty?[]:data});
    if(path==='/settings') {
      if(state.settingsError)return fail(503,'Schedule temporarily unavailable');
      const now=Date.now(); const iso=x=>new Date(now+x).toISOString();
      return ok({schedule:{registrationClosesAt:iso(state.registrationClosed?-60000:86400000),votingOpensAt:iso(state.phase==='upcoming'?3600000:-3600000),votingClosesAt:iso(state.phase==='closed'?-1000:7200000),resultsPublishedAt:iso(7200000),timezone:'Asia/Yangon'}});
    }
    if(path==='/auth/register') {assert.equal(req.method(),'POST');assert.ok(body.password.length>=8);state.registrations++;return ok({user:{id:'u',email:body.email,hasVotedKing:false,hasVotedQueen:false},votingKey:key});}
    const user=()=>({id:'u',email:'demo@example.test',hasVotedKing:Boolean(state.votes.king),hasVotedQueen:Boolean(state.votes.queen)});
    if(path==='/auth/login') {state.authenticated=true;return ok({token:'fixture-token',user:user()});}
    assert.equal(req.headers().authorization,'Bearer fixture-token');
    if(path==='/auth/me'){state.meCalls++;return state.expired?fail(401,'Session expired'):state.disabled?fail(403,'This account is disabled.'):ok({user:user()});}
    if(state.expired)return fail(401,'Session expired');
    if(state.disabled)return fail(403,'This account is disabled.');
    if(body.votingKey!==key)return fail(401,'Wrong voting key');
    if(state.phase!=='open')return fail(403,'Voting is not open');
    if(path==='/voting/my-votes') {state.reads++;return state.failReads?fail(503,'Cannot verify choices'):ok({votes:Object.entries(state.votes).map(([contest,candidate])=>({contest,candidate}))});}
    state.mutations.push({path,method:req.method(),contest:body.contest,candidateId:body.candidateId});
    if(path==='/voting/remove'){assert.equal(req.method(),'DELETE');delete state.votes[body.contest];}
    else {assert.equal(req.method(),path==='/voting/change'?'PATCH':'POST');state.votes[body.contest]=data.find(c=>c._id===body.candidateId);}
    if(state.dropMutation){state.dropMutation=false;return route.abort('connectionreset');}
    return route.fulfill({json:{status:'success',message:'Saved'}});
  });
  await page.goto(base);await page.getByRole('button',{name:'View profile'}).first().waitFor();
  return {page,context,errors};
}
async function login(page){await page.getByRole('button',{name:'My account'}).click();const d=page.getByRole('dialog');await d.getByLabel('Email address').fill('demo@example.test');await d.getByLabel('Password',{exact:true}).fill('festival123');await d.getByRole('button',{name:'Login',exact:true}).last().click();await d.waitFor({state:'hidden'});}
async function unlock(page,value=key){await page.getByRole('button',{name:'Enter voting key'}).click();await page.getByLabel('Voting key',{exact:true}).fill(value);await page.getByRole('button',{name:'Unlock my choices'}).click();if(value===key)await page.getByRole('dialog').waitFor({state:'hidden'});}
async function choose(page,index=0){await page.getByRole('button',{name:'View profile'}).nth(index).click();const d=page.getByRole('dialog');await d.getByRole('button',{name:/Vote for this candidate|Choose this candidate instead/}).click();}
async function confirm(page,name='Confirm vote'){await page.getByRole('dialog').getByRole('button',{name,exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
const report=[];
try {
  // Registration is a one-time display, requires acknowledgement, and does not log in.
  {
    const s=backend();const {page,context,errors}=await setup(s);
    await page.getByRole('button',{name:'Create account',exact:true}).click();
    const d=page.getByRole('dialog');await d.getByLabel('Email address').fill('new@example.test');await d.getByLabel('Password',{exact:true}).fill('password123');await d.getByRole('button',{name:'Create account',exact:true}).click();
    await page.getByText('Keep your little key safe.').waitFor();assert.equal(s.authenticated,false);assert.equal(s.registrations,1);
    assert.equal(await page.getByRole('button',{name:'Continue to login'}).isDisabled(),true);
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').isVisible(),true);
    await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Continue to login'}).click();assert.equal(await page.locator('#issued-key').count(),0);
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.deepEqual(errors,[]);await context.close();report.push('Registration: one-time key, acknowledgement, no automatic login, no browser storage');
  }
  {
    const s=backend();const {page,context,errors}=await setup(s);
    assert.equal((await page.locator('body').innerText()).includes('PRIVATE_CONTACT_MUST_NOT_RENDER'),false);
    await login(page);await unlock(page,'b'.repeat(64));await page.getByText('Wrong voting key',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Sign out',exact:true}).count(),1);assert.ok(s.meCalls>=2);
    await page.getByLabel('Voting key',{exact:true}).fill(key);await page.getByRole('button',{name:'Unlock my choices'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    await choose(page);await page.getByRole('dialog').getByRole('button',{name:'Keep browsing'}).click();assert.equal(s.mutations.length,0);
    await choose(page);await confirm(page);assert.equal(s.votes.king._id,'king-1');
    await page.locator('.category-tabs').getByRole('button',{name:'Queen',exact:true}).click();await choose(page);await confirm(page);assert.equal(s.votes.queen._id,'queen-1');assert.equal(s.votes.king._id,'king-1');
    await page.locator('.category-tabs').getByRole('button',{name:'King',exact:true}).click();await choose(page,1);await confirm(page,'Confirm change');assert.equal(s.votes.king._id,'king-2');assert.equal(s.votes.queen._id,'queen-1');
    await page.getByRole('button',{name:'Remove King vote'}).click();await page.getByRole('dialog').getByRole('button',{name:'Keep browsing'}).click();assert.ok(s.votes.king);
    await page.getByRole('button',{name:'Remove King vote'}).click();await confirm(page,'Yes, remove vote');assert.equal(s.votes.king,undefined);assert.ok(s.votes.queen);
    s.dropMutation=true;await choose(page,2);await confirm(page);await page.getByText(/request did not finish cleanly/).waitFor();assert.equal(s.votes.king._id,'king-3');assert.equal(s.mutations.length,5);
    assert.equal(await page.locator('#choices').getByRole('heading',{name:'Aung Sample 3'}).count(),1);
    s.dropMutation=true;s.failReads=true;await choose(page,1);await confirm(page,'Confirm change');await page.getByText(/We could not verify your saved choices/).waitFor();
    const mutations=s.mutations.length;await page.getByRole('button',{name:'View profile'}).first().click();await page.getByRole('button',{name:'Review saved choices'}).click();assert.equal(s.mutations.length,mutations);
    s.failReads=false;await page.getByRole('button',{name:'Refresh saved choices'}).click();await page.getByText('Your choices are unlocked for this session.').waitFor();assert.equal(await page.locator('#choices').getByRole('heading',{name:'Aung Sample 2'}).count(),1);
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    // Closing the period hides identities but retains participation flags.
    s.phase='closed';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('Voting has closed',{exact:true}).waitFor();assert.equal(await page.locator('#choices').getByText('Private choice',{exact:true}).count(),2);assert.equal(await page.locator('#choices').getByText('A vote is recorded for this contest.',{exact:true}).count(),2);
    await page.getByRole('button',{name:'Sign out',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Login to vote',exact:true}).count(),1);
    await login(page);await page.reload();await page.getByRole('button',{name:'Login to vote',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Sign out',exact:true}).count(),0);
    assert.deepEqual(errors,[]);await context.close();report.push('Public privacy, wrong-key 401, cancel/cast/change/remove, separate contests, interrupted writes, verification lock, close, sign-out and refresh');
  }
  {
    const s=backend();s.phase='upcoming';s.registrationClosed=true;const {page,context}=await setup(s,{width:390,height:844});
    await page.getByText('A moment worth waiting for',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Registration closed',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'View profile'}).first().click();assert.equal(await page.getByRole('button',{name:'Voting not available'}).isDisabled(),true);await page.getByRole('button',{name:'Close dialog'}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    s.candidateError=true;await page.reload();await page.getByRole('button',{name:'Retry candidates'}).waitFor();s.candidateError=false;s.empty=true;await page.getByRole('button',{name:'Retry candidates'}).click();await page.getByText('A little anticipation.',{exact:true}).waitFor();
    s.settingsError=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('button',{name:'Refresh schedule'}).waitFor();await context.close();report.push('Mobile no overflow, upcoming/registration-closed independence, public error/retry/empty, unavailable schedule');
  }
  {
    const s=backend();const {page,context}=await setup(s);await login(page);s.expired=true;await unlock(page,'b'.repeat(64));await page.getByText('Your session has ended.',{exact:false}).waitFor();await page.getByRole('button',{name:'Close dialog'}).click();assert.equal(await page.getByRole('button',{name:'Login to vote'}).count(),1);await context.close();report.push('Expired token is distinguished from a wrong voting key by account status');
  }
  {
    const s=backend(); const {page,context,errors}=await setup(s); await login(page); s.disabled=true;
    await unlock(page, 'b'.repeat(64)); await page.getByText('Your session has ended.',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Close dialog'}).click();
    assert.equal(await page.getByRole('button',{name:'Login to vote'}).count(),1);
    assert.deepEqual(errors,[]); await context.close(); report.push('Disabled accounts are signed out after a confirmed account-status 403');
  }
  console.log(report.map(text=>'PASS: '+text).join('\n'));
} finally {await browser.close();await server?.close();}
