// Focused integration check. Uses only a generated, disposable localhost database.
process.env.NODE_ENV='development';
process.env.AUTH_ORIGIN='http://localhost:5173';
process.env.AUTH_OTP_SECRET=require('node:crypto').randomBytes(32).toString('hex');
process.env.JWT_SECRET=require('node:crypto').randomBytes(40).toString('hex');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const jwt=require('jsonwebtoken');
const app=require('../app');
const security=require('../utils/accounts/security'),{Session}=require('../model/studentAuthModels');
const studentHeaders=new Map();
const Admin=require('../model/adminsModel');
const User=require('../model/usersModel');
const Controls=require('../model/eventControlsModel');
const Image=require('../model/imagesModel');
const Vote=require('../model/lanternVotesModel');
const Wish=require('../model/wishesModel');
const database='kqv_role_check_'+require('node:crypto').randomBytes(8).toString('hex');
let server,checks=0;
const token=(account,role)=>jwt.sign({role,v:0,[role==='admin'?'adminId':'userId']:String(account._id)},process.env.JWT_SECRET,{algorithm:'HS256'});
(async()=>{
 await mongoose.connect(process.env.AUTH_TEST_MONGO_URI.replace("/?", `/${database}?`),{autoCreate:false,autoIndex:false,serverSelectionTimeoutMS:3000});
 try{
  for(const model of Object.values(mongoose.models)){await model.createCollection();await model.createIndexes();}
  await Controls.create({_id:'event'});
  const admin=await Admin.create({username:'root-check',role:'admin',passwordHash:'unused'});
  const rootToken=token(admin,'admin');
  server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  async function call(path,auth,method='GET',body,expected=200){const res=await fetch(base+path,{method,headers:{...(studentHeaders.get(auth)||(auth?{Authorization:`Bearer ${auth}`} : {})),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const json=await res.json();assert.equal(res.status,expected,`${method} ${path}: ${json.message||''}`);checks++;return json.data;}
  async function create(role,permissions=[]){const data=await call('/admin/staff',rootToken,'POST',{username:role,password:'temporary-check-password',role,permissions},201);return {id:data.admin.id,token:token({_id:data.admin.id},'admin')};}
  const memory=await create('memory_admin'),lantern=await create('lantern_admin',['lantern.open','lantern.close','lantern.announce','lantern.hide']);
  const voting=await create('voting_admin');
  await call('/admin/memory-photos',memory.token);
  await call('/admin/memory-photos',voting.token,'GET',null,403);
  await call('/admin/staff',memory.token,'GET',null,403);
  await call('/candidates',memory.token,'POST',{},403);
  await call('/admin/candidates',memory.token,'GET',null,403);
  await call('/admin/candidates',lantern.token,'GET',null,403);
  await call('/admin/candidates',voting.token);
  await call('/admin/staff',rootToken,'POST',{username:'badrole',password:'temporary-check-password',role:'admin'},400);
  async function command(action,auth,expected=200){const data=await call('/admin/settings',auth);return call('/admin/controls/'+action,auth,'POST',{revision:data.controls.revision,operationId:require('node:crypto').randomUUID()},expected);}
  await command('memory.open',memory.token,403);
  await call('/admin/staff/'+memory.id,rootToken,'PATCH',{permissions:['memory.open','memory.close']});
  await command('memory.open',memory.token);
  await command('lantern.open',memory.token,403);
  await call('/admin/staff/'+memory.id,rootToken,'PATCH',{permissions:['memory.close']});
  await command('memory.open',memory.token,403);
  const images=await Image.create([{section:'lantern',url:'https://example.test/a.png',title:'A'},{section:'lantern',url:'https://example.test/b.png',title:'B'}]);
  const users=await User.create([1,2,3].map(n=>({email:`check${n}@gmail.com`,emailKey:`check${n}@gmail.com`,emailVerifiedAt:new Date(),passwordHash:'unused'})));
  const Photo=require('../model/memoryPhotosModel');
  const photos=await Photo.create([{owner:users[0]._id,imageKey:'check/a.png'},{owner:users[0]._id,imageKey:'check/b.png'},{owner:users[0]._id,imageKey:'check/c.png',status:'REJECTED'}]);
  await call('/admin/memory-photos/'+photos[0]._id+'/review',memory.token,'PATCH',{status:'APPROVED'},403);
  await call('/admin/staff/'+memory.id,rootToken,'PATCH',{permissions:['memory.approve']});
  await call('/admin/memory-photos/'+photos[0]._id+'/review',memory.token,'PATCH',{status:'APPROVED'});
  await call('/admin/memory-photos/'+photos[1]._id+'/review',memory.token,'PATCH',{status:'REJECTED'},403);
  await call('/admin/memory-photos/'+photos[0]._id+'/review',memory.token,'PATCH',{status:'APPROVED'},409);
  await call('/admin/staff/'+memory.id,rootToken,'PATCH',{permissions:['memory.reject']});
  await call('/admin/memory-photos/'+photos[1]._id+'/review',memory.token,'PATCH',{status:'REJECTED'});
  const allPhotos=await call('/admin/memory-photos',memory.token);assert.equal(allPhotos.photos.length,3);
  const usersTokens=[];
  for(const user of users){const raw=security.random(),browser=security.random(),expiry=Date.now()+86400000;await Session.create({_id:security.digest(raw),user:user._id,version:0,expiresAt:new Date(expiry)});const id=String(user._id);studentHeaders.set(id,{Cookie:`kq_session=${raw}; kq_browser=${browser}.${expiry}.${security.mac(`browser:${browser}:${expiry}`)}`,Origin:process.env.AUTH_ORIGIN,'X-CSRF-Token':security.csrf(browser)});usersTokens.push(id);}
  await command('lantern.open',lantern.token);
  const state=await call('/lantern-voting');
  const vote=(n,id,expected=200)=>call('/lantern-voting',usersTokens[n],'POST',{lanternId:String(id),window:state.window},expected);
  await vote(0,images[0]._id);await vote(0,images[0]._id);await vote(0,images[1]._id,409);
  await call('/images/'+images[0]._id,lantern.token,'PATCH',{title:'Cannot edit while open'},409);
  await command('lantern.announce',lantern.token,409);
  await vote(1,images[1]._id);await command('lantern.close',lantern.token);await command('lantern.announce',lantern.token,409);
  await command('lantern.open',lantern.token);const next=await call('/lantern-voting');
  await call('/lantern-voting',usersTokens[2],'POST',{lanternId:String(images[0]._id),window:state.window},409);
  await call('/lantern-voting',usersTokens[2],'POST',{lanternId:String(images[0]._id),window:next.window});
  await command('lantern.close',lantern.token);await command('lantern.announce',lantern.token);
  const result=await call('/lantern-voting');assert.equal(result.winner.lantern.title,'A');assert.equal(result.winner.votes,2);
  await call('/images/'+images[0]._id,lantern.token,'DELETE',null,409);
  const Candidate=require('../model/candidatesModel'), Ballot=require('../model/ballotsModel');
  const candidates=await Candidate.create(['king','king','queen','queen'].map((category,n)=>({fullName:'Candidate '+n,category,images:['https://example.test/c.png']})));
  await Ballot.create(users.flatMap((user,n)=>[
    {user:user._id,candidate:candidates[n===2?1:0]._id,contest:'king',round:1},
    {user:user._id,candidate:candidates[n===2?3:2]._id,contest:'queen',round:1}
  ]));
  await Controls.updateOne({_id:'event'},{$set:{votingStatus:'open'}});
  await call('/admin/vote-totals',voting.token,'GET',null,403);
  await call('/admin/staff/'+voting.id,rootToken,'PATCH',{permissions:['votes.read']});
  const counts=await call('/admin/vote-totals',voting.token);assert.equal(counts.entries.length,4);assert.equal(counts.entries[0].votes,2);
  await call('/admin/vote-totals',memory.token,'GET',null,403);
  await call('/admin/lantern-vote-totals',lantern.token,'GET',null,403);
  await call('/admin/staff/'+lantern.id,rootToken,'PATCH',{permissions:['lantern.votes.read']});
  const lanternCounts=await call('/admin/lantern-vote-totals',lantern.token);assert.equal(lanternCounts.entries[0].votes,2);
  await call('/admin/lantern-vote-totals',voting.token,'GET',null,403);
  await call('/results',null,'GET',null,403);
  await Controls.updateOne({_id:'event'},{$set:{votingStatus:'closed'}});
  await command('announcement.open',rootToken);
  const awards=await call('/results');
  assert.deepEqual(awards.results.kings.map(row=>row.title),['Mrs Thadingyut','Prince']);
  assert.deepEqual(awards.results.queens.map(row=>row.title),['Miss Thadingyut','Princess']);
  assert.deepEqual(awards.results.kings.map(row=>row.votes),[2,1]);
  await call('/admin/staff/'+voting.id,rootToken,'PATCH',{permissions:[]});
  await call('/admin/vote-totals',voting.token,'GET',null,403);
  const selectAwards=require('../utils/voteTotals').awards;
  assert.throws(()=>selectAwards([{candidate:{category:'king'},votes:2},{candidate:{category:'king'},votes:2}]),/tied/);
  assert.throws(()=>selectAwards([{candidate:{category:'queen'},votes:3},{candidate:{category:'queen'},votes:1},{candidate:{category:'queen'},votes:1}]),/tied/);
  assert.equal(selectAwards([{candidate:{category:'king'},votes:0}]).kings.length,0);
  await Wish.create({user:users[0]._id,slot:1,message:'Public check wish'});
  const wishes=await call('/wishes');assert.equal(wishes.total,1);
  assert.equal(await Vote.countDocuments({}),3);
  console.log(`Focused role/lantern checks passed: ${checks} HTTP assertions plus winner, vote uniqueness and wish total.`);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(mongoose.connection.name===database && database.startsWith('kqv_role_check_'))await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
 }
})().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exit(1);});
