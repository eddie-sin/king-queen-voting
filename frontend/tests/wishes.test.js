import test from 'node:test';import assert from 'node:assert/strict';
import {createWishApi,publicWish,normalizeAllowance,WishError} from '../src/wishes/wishApi.js';
import {WishFeed} from '../src/wishes/WishFeed.js';
import {createWishFixtureApi} from '../src/fixtures/wishFixtureApi.js';
import {wishBackendConfig} from '../src/wishes/wishBackendConfig.js';
test('public projection drops identity/times; allowance capped at 3',()=>{assert.deepEqual(publicWish({id:'1',message:'hope',author:'PRIVATE',createdAt:'PRIVATE'}),{id:'1',message:'hope'});assert.equal(publicWish({id:'1',message:' '}),null);assert.deepEqual(normalizeAllowance({used:4}),{used:4,remaining:0});assert.throws(()=>normalizeAllowance({used:-1}));});
test('paginated feed reaches all 137 wishes with bounded queue and serial reads',async()=>{const api=createWishFixtureApi({count:137,delayMs:0});const feed=new WishFeed(api);await feed.init();const seen=new Set();for(let i=0;i<137;i++){const w=await feed.take();seen.add(w.id);assert.ok(feed.queue.length<=80);}assert.equal(seen.size,137);assert.ok(await feed.take());});
test('account fixture atomically caps wishes and preserves other accounts',async()=>{const api=createWishFixtureApi({delayMs:0});const results=await Promise.allSettled(Array.from({length:4},(_,i)=>api.create('one',String(i))));assert.equal(results.filter(x=>x.status==='fulfilled').length,3);assert.deepEqual(await api.allowance('one'),{used:3});assert.deepEqual(await api.allowance('two'),{used:0});await assert.rejects(api.create(null,'test'));});
test('adapter requires explicit backend contract; public requests omit auth; POST handles uncertain outcomes',async()=>{
 await assert.rejects(createWishApi().list(),/not connected/);
 const calls=[];const api=createWishApi({listRequest:()=>({path:'/test-only'}),mapList:p=>p.data,allowanceRequest:()=>({path:'/test-only-quota'}),mapAllowance:p=>p.data,createRequest:message=>({path:'/test-only-create',method:'POST',body:{message}}),mapCreated:p=>p.data,fetchImpl:async(url,options)=>{calls.push({url,options});if(options.method==='POST')throw Error('lost');return new Response(JSON.stringify({status:'success',data:{wishes:[{id:'1',message:'hope',author:'PRIVATE'}],nextCursor:null}}));}});
 const result=await api.list();assert.equal(calls[0].options.headers.Authorization,undefined);assert.deepEqual(result.wishes,[{id:'1',message:'hope'}]);
 await assert.rejects(api.create('fixture-token','Hope'),e=>e instanceof WishError&&e.interrupted);assert.equal(calls[1].options.headers.Authorization,'Bearer fixture-token');assert.equal(calls[1].options.body,JSON.stringify({message:'Hope'}));
});
test('production Wish Sky adapter matches the public cursor and authenticated allowance/create contract',async()=>{
 const calls=[];
 const longMessage='a'.repeat(600);
 const replies=[
  {data:{wishes:[{id:'w1',message:'Hope',createdAt:'PRIVATE'}],nextCursor:'opaque-cursor'}},
  {data:{used:2,remaining:1}},
  {data:{wish:{id:'w2',message:longMessage}}},
 ];
 const api=createWishApi({...wishBackendConfig,fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({status:'success',...replies.shift()}));}});
 assert.deepEqual(await api.list({limit:40,cursor:'previous'}),{wishes:[{id:'w1',message:'Hope'}],nextCursor:'opaque-cursor',total:null});
 assert.deepEqual(await api.allowance('token'),{used:2,remaining:1});
 assert.deepEqual(await api.create('token',longMessage),{wish:{id:'w2',message:longMessage}});
 assert.deepEqual(calls.map(call=>[call.url,call.options.method,call.options.headers.Authorization]),[
  ['/api/v1/wishes?limit=40&cursor=previous','GET',undefined],
  ['/api/v1/wishes/mine','GET','Bearer token'],
  ['/api/v1/wishes','POST','Bearer token'],
 ]);
 assert.deepEqual(JSON.parse(calls[2].options.body),{message:longMessage});
});
