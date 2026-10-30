const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
test('student limiter exhaustion does not disable staff/config, and source-scoped accounts avoid remote lockout',()=>{
 const limiter=require('../middleware/authRateLimit');const call=(kind,ip,email)=>{let error;limiter(kind)({ip,body:kind==='staff'?{username:email}:{email}},{set(){}},e=>{error=e;});return error;};
 for(let n=0;n<16;n++)call('staff','attacker','organiser');assert.equal(call('staff','attacker','organiser').statusCode,429);assert.equal(call('staff','trusted','organiser'),undefined);
 for(let n=0;n<4200;n++)call('student','source-'+n,`user${n}@gmail.com`);
 assert.equal(call('config','campus'),undefined);assert.equal(call('staff','organiser-source','root'),undefined);
});
test('upload gate limits buffering, preserves the active processing slot after disconnect, and drains safely',()=>{
 const admit=require('../middleware/uploadAdmission');let first=0,second=0,error;
 const a={userId:'a'},b={userId:'b'},ra=new EventEmitter(),rb=new EventEmitter();ra.set=rb.set=()=>{};
 admit(a,ra,e=>{assert(!e);first++;});assert.equal(first,1);
 a.uploadProcessing=true;admit(b,rb,e=>{assert(!e);second++;});assert.equal(second,0);
 const queued=[];for(let n=0;n<2;n++){const req={userId:'a'},res=new EventEmitter();res.set=()=>{};admit(req,res,()=>{});queued.push(req);}
 const duplicate=new EventEmitter();duplicate.set=()=>{};admit({userId:'a'},duplicate,e=>{error=e;});assert.equal(error.statusCode,409);
 ra.emit('close');assert.equal(second,0);a.releaseUpload();assert.equal(second,1);b.releaseUpload();for(const req of queued)req.releaseUpload();
});
