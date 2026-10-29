const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const config = require('../utils/accounts/config');
const security = require('../utils/accounts/security');
const prod = '307069587123-a38ssh3vg3fg7o0tvgnaan3mcssa9unb.apps.googleusercontent.com';
const valid = {NODE_ENV:'production',AUTH_ENVIRONMENT:'production',AUTH_ORIGIN:'https://gusto-thadingyut-festival.eddiespace.com',GOOGLE_CLIENT_ID_PRODUCTION:prod,GOOGLE_CLIENT_ID_DEVELOPMENT:'development',RESEND_API_KEY:'fake-never-used',AUTH_OTP_SECRET:crypto.randomBytes(32).toString('hex'),AUTH_MAIL_SECRET:crypto.randomBytes(32).toString('hex'),AUTH_EMAIL_FROM:'GUSTO Thadingyut Festival <noreply@auth.eddiespace.com>',HOST:'127.0.0.1',PORT:'5000'};
test('public startup rejects local origins, wrong audience, shared secrets, bad sender and wrong port',()=>{
 Object.assign(process.env,valid);config.validate();
 for(const change of [{AUTH_ORIGIN:'http://localhost:5173'},{GOOGLE_CLIENT_ID_PRODUCTION:'development'},{AUTH_MAIL_SECRET:valid.AUTH_OTP_SECRET},{AUTH_EMAIL_FROM:'Other <sender@elsewhere.com>'},{PORT:'5002'},{HOST:'0.0.0.0'},{AUTH_ENVIRONMENT:'unknown'},{NODE_ENV:'development'}]) {
  Object.assign(process.env,valid,change);assert.throws(()=>config.validate());
 }
 Object.assign(process.env,valid);assert.equal(config.settings().clientId,prod);
});
test('local production-mode laptop keeps a separate development audience',()=>{
 Object.assign(process.env,valid,{AUTH_ENVIRONMENT:'local',AUTH_ORIGIN:'http://localhost:5173',PORT:'5002'});config.validate();assert.equal(config.settings().clientId,'development');
});
test('secure cookies are host-only HttpOnly Lax and clear with matching attributes',()=>{
 Object.assign(process.env,valid);const calls=[];
 const res={cookie:(...args)=>calls.push(args),clearCookie:(...args)=>calls.push(args)};
 security.browser({headers:{}},res,true);security.setSession(res,security.random());security.clearSession(res);
 assert.deepEqual(calls.map(x=>x[0]),['__Host-kq_browser','__Host-kq_session','__Host-kq_session']);
 for (const call of calls) {const o=call.at(-1);assert.equal(o.httpOnly,true);assert.equal(o.secure,true);assert.equal(o.path,'/');assert.equal(o.sameSite,'lax');assert.equal(o.domain,undefined);}
 assert.equal(calls[1][2].maxAge,18000000);
});
