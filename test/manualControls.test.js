const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
process.env.NODE_ENV='test';process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
process.env.ADMIN_USERNAME='isolated-admin';process.env.ADMIN_PASSWORD='isolated-strong-password';
process.env.GOOGLE_CLIENT_ID_DEVELOPMENT='fake';process.env.RESEND_API_KEY='fake';
const {createUser,studentToken,headers} = require('./helpers/accounts.cjs');
const {start} = require('./helpers/replica.cjs');
const app=require('../app'), Controls=require('../model/eventControlsModel'), Ballot=require('../model/ballotsModel'), Candidate=require('../model/candidatesModel');
const {seed}=require('../utils/seed');
let mongo,server,base,admin,user,token;
async function request(path,body,expected=200,auth=admin) {
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(auth===token?headers(token):auth?{Authorization:`Bearer ${auth}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();assert.equal(response.status,expected,`${path}: ${JSON.stringify(data)}`);return data.data;
}
async function command(action,extra={}) {return request('/admin/controls/'+action,{revision:(await Controls.findById('event')).revision,operationId:crypto.randomUUID(),...extra});}
before(async()=>{
 mongo=await start();await mongoose.connect(mongo.uri.replace('/?','/manual_regression?'),{autoCreate:false,autoIndex:false});await seed();
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api/v1`;
 admin=(await request('/auth/admin/login',{username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD},200,null)).token;
 user=await createUser({email:'manual@gmail.com'});token=await studentToken(user);
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();await mongo?.close();});
test('cookie students retain one immutable vote per category across manual closure, reopen and restart',async()=>{
 const candidates=await Candidate.create(['king','king','queen'].map((category,n)=>({fullName:'Candidate '+n,category,images:['https://example.test/image.png']})));
 const vote=async(n,expected)=>{const c=await Controls.findById('event');return request('/voting/submit',{candidateId:String(candidates[n]._id),contest:candidates[n].category,round:c.round,window:c.window},expected,token);};
 await command('registration.open');await command('voting.open');
 const c=await Controls.findById('event');
 const responses=await Promise.all(Array.from({length:12},()=>fetch(base+'/voting/submit',{method:'POST',headers:{...headers(token),'Content-Type':'application/json'},body:JSON.stringify({candidateId:String(candidates[0]._id),contest:'king',round:c.round,window:c.window})})));
 assert.equal(responses.filter(r=>r.status===201).length,1);assert.equal(responses.filter(r=>r.status===200).length,11);assert.equal(await Ballot.countDocuments(),1);
 await vote(1,409);await vote(2,201);await command('voting.close');await vote(2,409);
 const before=await Ballot.find().lean();await command('voting.open');await vote(1,409);
 await seed();assert.equal((await Controls.findById('event')).votingStatus,'closed');assert.equal((await Controls.findById('event')).registrationOpen,true);
 assert.deepEqual(await Ballot.find().lean(),before);assert.equal((await request('/auth/me',undefined,200,token)).user.id,String(user._id));
 await request('/voting/submit',{candidateId:String(candidates[0]._id),contest:'king',round:c.round,window:c.window},409,token);
 await command('votes.clear',{confirmation:'CLEAR ALL VOTES'});assert.equal(await Ballot.countDocuments(),0);
 assert.equal(await require('../model/usersModel').countDocuments(),1);
 await command('voting.open');await vote(1,201);assert.equal(await Ballot.countDocuments(),1);
});
test('public candidate views omit private contacts and cookie students cannot mutate staff galleries',async()=>{
 await command('voting.close');
 const created=await request('/candidates',{fullName:'Private Contact',category:'queen',images:['https://example.test/public.png'],contactNumber:'0999999999'},201);
 const id=created.candidate._id;
 const publicRows=await request('/candidates',undefined,200,null);
 assert(!JSON.stringify(publicRows).includes('0999999999'));
 assert.equal((await request('/admin/candidates/'+id)).candidate.contactNumber,'0999999999');
 await Candidate.updateOne({_id:id},{$set:{isActive:false}});
 assert(!(await request('/candidates',undefined,200,null)).candidates.some(row=>row._id===id));
 for(const endpoint of ['/candidates','/images']) {
  await request(endpoint,{},401,null);await request(endpoint,{},401,token);
 }
 await request('/admin/staff',{username:'forged',password:'strong-password',role:'admin'},401,token);
});
test('Wish Sky keeps cookie ownership private and enforces three wishes during concurrent requests',async()=>{
 await request('/wishes',{message:'anonymous'},401,null);
 await request('/wishes',{message:'forged',user:crypto.randomBytes(12).toString('hex')},400,token);
 await request('/wishes',{message:'forged',name:'x'.repeat(61)},400,token);
 const named=await request('/wishes',{message:'A named wish',name:'  Aye  '},201,token);
 assert.equal(named.wish.name,'Aye');
 const responses=await Promise.all(Array.from({length:10},(_,n)=>fetch(base+'/wishes',{method:'POST',headers:{...headers(token),'Content-Type':'application/json'},body:JSON.stringify({message:'Wish '+n})})));
 assert.equal(responses.filter(r=>r.status===201).length,2);assert.equal(responses.filter(r=>r.status===409).length,8);
 assert.equal((await request('/wishes/mine',undefined,200,token)).used,3);
 const wishes=await request('/wishes',undefined,200,null);
 assert.equal(wishes.wishes.length,3);
 assert.equal(wishes.wishes.find(wish=>wish.id===named.wish.id).name,'Aye');
 for(const wish of wishes.wishes)assert.deepEqual(Object.keys(wish).sort(),wish.name?['id','message','name','reacted','reactions']:['id','message','reacted','reactions']);
 assert(!JSON.stringify(wishes).includes(String(user._id)));assert(!JSON.stringify(wishes).includes(user.email));
 const anonymousHeaders={...headers(token),Cookie:headers(token).Cookie.split('; ').find(part=>part.startsWith('kq_browser=')),'Content-Type':'application/json'};
 const react=async active=>{
  const response=await fetch(base+'/wishes/'+named.wish.id+'/reaction',{method:'POST',headers:anonymousHeaders,body:JSON.stringify({active})});
  assert.equal(response.status,200);return (await response.json()).data;
 };
 assert.deepEqual(await react(true),{reactions:1,reacted:true});
 assert.deepEqual(await react(true),{reactions:1,reacted:true});
 assert.equal((await request('/wishes',undefined,200,null)).wishes.find(wish=>wish.id===named.wish.id).reactions,1);
 assert.deepEqual(await react(false),{reactions:0,reacted:false});
 await request('/wishes/mine/wishes',undefined,401,null);
 await request('/wishes/mine/wishes',undefined,401,admin);
 const mine=await request('/wishes/mine/wishes',undefined,200,token);
 assert.equal(mine.wishes.length,3);
 assert.deepEqual(new Set(mine.wishes.map(wish=>wish.id)),new Set(wishes.wishes.map(wish=>wish.id)));
 assert(!JSON.stringify(mine).includes(String(user._id)));
 const other=await createUser({email:'otherwishes@gmail.com'}),otherToken=await studentToken(other);
 const otherRead=await fetch(base+'/wishes/mine/wishes',{headers:headers(otherToken)});
 assert.equal(otherRead.status,200);assert.deepEqual((await otherRead.json()).data.wishes,[]);
 const otherCreate=await fetch(base+'/wishes',{method:'POST',headers:{...headers(otherToken),'Content-Type':'application/json'},body:JSON.stringify({message:'Another account’s wish'})});
 assert.equal(otherCreate.status,201);
 const otherWish=(await otherCreate.json()).data.wish;
 const refreshed=await request('/wishes/mine/wishes?user='+other._id,undefined,200,token);
 assert.equal(refreshed.wishes.length,3);assert(!refreshed.wishes.some(wish=>wish.id===otherWish.id));
});
