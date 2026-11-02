const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {ObjectId}=require('mongoose').Types;
const {createV2Fixture}=require('./fixtures/v2Fixture.cjs');
let f;
before(async()=>{f=await createV2Fixture();},{timeout:60000});
beforeEach(async()=>{await f.reset();},{timeout:60000});after(async()=>{await f?.close();});
async function setup(){const student=await f.student();const manager=await f.staff('participation_admin',['participation.read','participation.update']);const k=new ObjectId(),q=new ObjectId(),l=new ObjectId();await f.db.collection('candidates').insertMany([{_id:k,category:'king',isActive:true,fullName:'King',images:[]},{_id:q,category:'queen',isActive:true,fullName:'Queen',images:[]}]);await f.db.collection('images').insertOne({_id:l,section:'lantern',url:'/test.png'});await f.command('voting.open');await f.command('lantern.open');await f.command('memory.open');return{student,manager,k,q,l};}
async function change(s,enabled,revision,operationId=crypto.randomUUID()){return f.request('PATCH','/admin/participation/users/'+s.student.user.id,{token:s.manager.token,body:{enabled,revision,operationId}});}
async function votes(s){const c=(await f.request('GET','/settings')).body.data.controls;return Promise.all([f.request('POST','/voting/submit',{token:s.student.token,body:{candidateId:String(s.k),contest:'king',round:c.round,window:c.window}}),f.request('POST','/voting/submit',{token:s.student.token,body:{candidateId:String(s.q),contest:'queen',round:c.round,window:c.window}}),f.request('POST','/lantern-voting',{token:s.student.token,body:{lanternId:String(s.l),window:c.lanternWindow}})]);}
function photo(){const form=new FormData();form.append('images',new Blob([require('fs').readFileSync(require('path').resolve(__dirname,'../postman/fixtures/memory-photo.png'))],{type:'image/png'}),'photo.png');return form;}
test('master/user matrix, unchanged votes/photos/slots, wishes and likes remain independent',async()=>{const s=await setup();await f.command('participation.require');for(const r of await votes(s)){assert.equal(r.status,403);assert.equal(r.body.reason,'PARTICIPATION_REQUIRED');}
 assert.equal((await f.request('POST','/memory-photos',{token:s.student.token,body:photo()})).status,403);
 assert.equal((await change(s,true,0)).status,200);for(const r of await votes(s))assert([200,201].includes(r.status));
 const upload=await f.request('POST','/memory-photos',{token:s.student.token,body:photo()});assert.equal(upload.status,201,JSON.stringify(upload.body));const id=new ObjectId(upload.body.data.photo.id);await f.db.collection('memoryphotos').updateOne({_id:id},{$set:{status:'APPROVED'}});
 const before=await f.db.collection('memoryphotos').findOne({_id:id});await change(s,false,1);
 assert.equal((await f.request('POST','/memory-photos',{token:s.student.token,body:photo()})).status,403);
 const mine=await f.request('GET','/memory-photos/mine',{token:s.student.token});assert.equal(mine.status,200);assert.equal(mine.body.data.quota.remainingSlots,2);assert.equal(mine.body.data.participationAllowed,false);
 assert.equal(await f.db.collection('ballots').countDocuments(),2);assert.equal(await f.db.collection('lanternvotes').countDocuments(),1);assert.deepEqual(await f.db.collection('memoryphotos').findOne({_id:id}),before);
 assert.equal((await f.request('POST','/memory-photos/'+id+'/like',{token:s.student.token,body:{}})).status,200);
 assert.equal((await f.request('PATCH','/memory-photos/'+id+'/archive',{token:s.student.token,body:{}})).status,200);
 assert.equal((await f.request('PATCH','/memory-photos/'+id+'/unarchive',{token:s.student.token,body:{}})).status,200);
 const wish=await f.request('POST','/wishes',{token:s.student.token,body:{message:'Still able to post a wish'}});assert([200,201].includes(wish.status),JSON.stringify(wish.body));
 await f.command('participation.bypass');assert.equal((await f.request('POST','/memory-photos',{token:s.student.token,body:photo()})).status,201);await f.command('participation.require');assert.equal((await f.request('POST','/memory-photos',{token:s.student.token,body:photo()})).status,403);
 await change(s,true,2);assert.equal((await f.request('POST','/memory-photos',{token:s.student.token,body:photo()})).status,201);for(const r of await votes(s))assert.equal(r.status,200);assert.equal(await f.db.collection('ballots').countDocuments(),2);
});
test('manager scopes, safe list/search, concurrency revisions, receipts and startup persistence',async()=>{const s=await setup();const list=await f.request('GET','/admin/participation/users?search='+encodeURIComponent(s.student.user.email),{token:s.manager.token});assert.equal(list.status,200);assert.equal(list.body.data.users.length,1);assert.equal(list.body.data.users[0].participationEnabled,false);assert(!JSON.stringify(list.body).includes('passwordHash'));
 assert.equal((await f.command('participation.require',s.manager.token)).status,403);assert.equal((await f.request('GET','/admin/vote-totals',{token:s.manager.token})).status,403);assert.equal((await f.request('GET','/admin/participation/users',{token:s.student.token})).status,401);
 const op=crypto.randomUUID();assert.equal((await change(s,true,0,op)).status,200);assert.equal((await change(s,false,0)).status,409);assert.equal((await change(s,false,1)).status,200);assert.equal((await change(s,true,0,op)).body.data.user.participationEnabled,false);assert.equal((await change(s,false,0,op)).status,409);
 await f.restart();const row=(await f.request('GET','/admin/participation/users',{token:s.manager.token})).body.data.users[0];assert.equal(row.participationEnabled,false);assert.equal(row.revision,2);
});

test('revocation during storage refuses final acceptance, releases only the new slot and preserves the saved photo',async()=>{const s=await setup();await f.command('participation.require');await change(s,true,0);
 const accepted=await f.request('POST','/memory-photos',{token:s.student.token,body:photo()});assert.equal(accepted.status,201);const first=await f.db.collection('memoryphotos').findOne({_id:new ObjectId(accepted.body.data.photo.id)});
 await f.pauseMemoryUpload();const paused=f.waitMemoryUploadPaused();const running=f.request('POST','/memory-photos',{token:s.student.token,body:photo()});await paused;
 try{assert.equal((await change(s,false,1)).status,200);}finally{f.resumeMemoryUpload();}
 const denied=await running;assert.equal(denied.status,403);assert.equal(denied.body.reason,'PARTICIPATION_REQUIRED');
 assert.deepEqual(await f.db.collection('memoryphotos').findOne({_id:first._id}),first);
 const mine=await f.request('GET','/memory-photos/mine',{token:s.student.token});assert.equal(mine.body.data.photos.length,1);assert.equal(mine.body.data.quota.remainingSlots,2);
},{timeout:30000});
