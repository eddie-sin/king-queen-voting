const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const {createV2Fixture}=require('./fixtures/v2Fixture.cjs');let f;
before(async()=>{f=await createV2Fixture();await f.reset();},{timeout:60000});after(async()=>await f?.close());
test('thumbnail metadata is bounded, authorised, persistent, preserves the original and obeys edit locks',async()=>{
 const staff=await f.staff('lantern_admin');const form=new FormData();form.append('section','lantern');form.append('title','Thumbnail test');form.append('images',new Blob([require('fs').readFileSync(require('path').join(__dirname,'../postman/fixtures/memory-photo.png'))],{type:'image/png'}),'photo.png');const created=await f.request('POST','/images',{token:staff.token,body:form});assert.equal(created.status,201);const image=created.body.data.images[0];
 for(const thumbnailPosition of [{x:-1,y:50},{x:50,y:101},{x:'50',y:50},{x:50,y:50,z:0},null])assert.equal((await f.request('PATCH','/images/'+image._id,{token:staff.token,body:{thumbnailPosition}})).status,400);
 const body={thumbnailPosition:{x:25,y:100}};assert.equal((await f.request('PATCH','/images/'+image._id,{body})).status,401);const wrong=await f.staff('voting_admin');assert.equal((await f.request('PATCH','/images/'+image._id,{token:wrong.token,body})).status,403);
 let saved=await f.request('PATCH','/images/'+image._id,{token:staff.token,body});assert.equal(saved.status,200);assert.deepEqual(saved.body.data.image.thumbnailPosition,body.thumbnailPosition);assert.equal(saved.body.data.image.url,image.url);
 saved=await f.request('PATCH','/images/'+image._id,{token:staff.token,body:{description:'Changed story'}});assert.deepEqual(saved.body.data.image.thumbnailPosition,body.thumbnailPosition);
 await f.restart();let rows=await f.request('GET','/images?section=lantern');assert.deepEqual(rows.body.data.images[0].thumbnailPosition,body.thumbnailPosition);
 await f.command('lantern.open',(await f.login('v2-root')).token);assert.equal((await f.request('PATCH','/images/'+image._id,{token:staff.token,body:{thumbnailPosition:{x:50,y:0}}})).status,409);
 assert.equal(await f.db.collection('lanternvotes').countDocuments(),0);
});
