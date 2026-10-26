import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authConfig,clearAuthConfig} from '../src/authSession.js';
import {createApi} from '../src/api.js';
test('security config refreshes after its lifetime and a failed mutation is never automatically replayed',async()=>{
 clearAuthConfig();let configCalls=0, mutations=0;let now=Date.now();const original=Date.now;Date.now=()=>now;
 const fetchImpl=async path=>{
  if(path.endsWith('/auth/config'))return {ok:true,json:async()=>({data:{csrfToken:'test'+(++configCalls),refreshAfter:1000}})};
  mutations++;return {ok:false,status:403,json:async()=>({status:'fail',message:'Refresh this page before continuing.'})};
 };
 try {
  await Promise.all([authConfig(fetchImpl),authConfig(fetchImpl)]);assert.equal(configCalls,1);
  now+=1001;await authConfig(fetchImpl);assert.equal(configCalls,2);
  const api=createApi({fetchImpl});await assert.rejects(api.authAction('/logout',{}));assert.equal(mutations,1);
  await authConfig(fetchImpl);assert.equal(configCalls,3);assert.equal(mutations,1);
 }finally{Date.now=original;clearAuthConfig();}
});
