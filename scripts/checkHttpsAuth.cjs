// Real local TLS with a temporary certificate and canonical production-origin API checks.
const assert=require('node:assert/strict'), crypto=require('node:crypto'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),https=require('node:https');
const {execFileSync}=require('node:child_process'),mongoose=require('mongoose');
Object.assign(process.env,{NODE_ENV:'production',AUTH_ENVIRONMENT:'production',AUTH_TEST_MODE:'true',AUTH_ORIGIN:'https://gusto-thadingyut-festival.eddiespace.com',GOOGLE_CLIENT_ID_PRODUCTION:'307069587123-a38ssh3vg3fg7o0tvgnaan3mcssa9unb.apps.googleusercontent.com',AUTH_EMAIL_FROM:'GUSTO Thadingyut Festival <noreply@auth.eddiespace.com>',AUTH_OTP_SECRET:crypto.randomBytes(32).toString('hex'),AUTH_MAIL_SECRET:crypto.randomBytes(32).toString('hex'),RESEND_API_KEY:'fake',PORT:'5000',HOST:'127.0.0.1'});
const app=require('../app'),Controls=require('../model/eventControlsModel'),security=require('../utils/accounts/security'),{Mail,Session}=require('../model/studentAuthModels');
const db='kqv_https_'+crypto.randomBytes(8).toString('hex');
let server,directory,ca,cookies={},csrf;
async function request(endpoint,body,expected=200,extra={}) {
 const response=await new Promise((resolve,reject)=>{
  const req=https.request({hostname:'localhost',family:4,port:server.address().port,path:'/api/v1'+endpoint,method:body?'POST':'GET',ca,headers:{Origin:process.env.AUTH_ORIGIN,'Content-Type':'application/json',Cookie:Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; '),...(csrf?{'X-CSRF-Token':csrf}:{}),...extra}},res=>{let data='';res.on('data',b=>data+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(data)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
 assert.equal(response.status,expected,JSON.stringify(response.body));
 for(const value of response.headers['set-cookie']||[]){const pair=value.split(';')[0].split('=');cookies[pair[0]]=pair[1];assert.match(value,/Secure/);assert.match(value,/HttpOnly/);assert.match(value,/SameSite=Lax/);assert(!value.includes('Domain='));assert(pair[0].startsWith('__Host-'));}
 if(response.body.data?.csrfToken)csrf=response.body.data.csrfToken;
 return response.body.data;
}
async function main(){
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'kqv-tls-'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',path.join(directory,'key.pem'),'-out',path.join(directory,'cert.pem')],{stdio:'ignore'});
 ca=await fs.readFile(path.join(directory,'cert.pem'));
 await mongoose.connect(process.env.AUTH_TEST_MONGO_URI.replace('/?',`/${db}?`));
 try{
  for(const model of Object.values(mongoose.models))await model.init();
  await Controls.create({_id:'event',registrationOpen:true});
  server=https.createServer({key:await fs.readFile(path.join(directory,'key.pem')),cert:ca},app);server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const config=await request('/auth/config');assert.equal(config.googleClientId,process.env.GOOGLE_CLIENT_ID_PRODUCTION);
  assert.equal((await request('/health/ready')).environment,'production');
  const start=await request('/auth/register/start',{email:'tlscheck@gmail.com',password:'strong-password123',operationId:crypto.randomUUID()});
  const code=security.unseal((await Mail.findById(start.flowId).select('+payload')).payload).text.match(/code is (\d{6})/)[1];
  await request('/auth/register/verify',{flowId:start.flowId,code});await request('/auth/me');
  await request('/auth/logout',{},403,{Origin:'https://evil.example'});await request('/auth/logout',{},403,{'X-CSRF-Token':'wrong'});await request('/auth/me');
  await request('/auth/logout',{});await request('/auth/me',null,401);assert.equal(await Session.countDocuments(),0);
  assert.equal((await Mail.findById(start.flowId)).status,'pending');
  console.log('HTTPS auth passed: verified local TLS, production audience, __Host-/Secure/HttpOnly/host-only cookies, CSRF/origin refusal, restore and logout. Real emails: 0.');
 }finally{if(server)await new Promise(r=>server.close(r));await mongoose.connection.dropDatabase();await mongoose.disconnect();await fs.rm(directory,{recursive:true,force:true});}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
