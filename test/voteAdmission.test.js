const {test}=require('node:test');const assert=require('node:assert/strict');
function fresh(){delete require.cache[require.resolve('../utils/voteAdmission')];return require('../utils/voteAdmission');}
const state=(window,votingStatus='open')=>({round:1,window,votingStatus,announcementOpen:false});
test('shared database opening starts admission without a local admin command',async()=>{const a=fresh();a.synchronize(state(1));assert.equal(await a.admit(async()=>42),42);a.close();});
test('an old open snapshot cannot reverse local close/drain; a new window can reopen',async()=>{
 const a=fresh();a.open(state(1));a.close(state(1));a.synchronize(state(1));await assert.rejects(a.admit(async()=>1),{statusCode:409});
 a.synchronize(state(2));assert.equal(await a.admit(async()=>2),2);a.close(state(2));
});
test('external closure cancels waiting votes but allows already admitted work to drain',async()=>{
 const a=fresh();a.synchronize(state(1));let release;const held=new Promise(r=>{release=r;});
 const active=Array.from({length:4},()=>a.admit(()=>held));const pending=a.admit(async()=>99);const denied=assert.rejects(pending,{statusCode:409});
 a.synchronize(state(1,'closing'));await denied;a.synchronize(state(1));await assert.rejects(a.admit(async()=>1),{statusCode:409});release(7);assert.deepEqual(await Promise.all(active),[7,7,7,7]);await a.drain();
});

test('a delayed old closed snapshot cannot cancel a newer open window',async()=>{const a=fresh();a.synchronize({...state(2),revision:4});a.synchronize({...state(1,'closed'),revision:3});assert.equal(await a.admit(async()=>1),1);a.close();});
