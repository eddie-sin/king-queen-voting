// Exercise the public template with temporary ports, certificate, pages and fake API.
const assert=require('node:assert/strict'), fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path'), http=require('node:http'), https=require('node:https');
const {spawn,execFileSync}=require('node:child_process');
const {freePort}=require('../test/helpers/replica.cjs');
async function main(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kqv-nginx-'));let api,nginx,exited;
 try{
  const httpPort=await freePort(),tlsPort=await freePort();
  for(const site of ['frontend','admin']){await fs.mkdir(path.join(dir,site,'dist'),{recursive:true});await fs.writeFile(path.join(dir,site,'dist/index.html'),`<div id="root">${site} fixture</div>`);}
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem')],{stdio:'ignore'});
  const ca=await fs.readFile(path.join(dir,'cert.pem'));
  api=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','public,max-age=3600');res.end(JSON.stringify({path:req.url,forwarded:req.headers['x-forwarded-for'],host:req.headers.host,protocol:req.headers['x-forwarded-proto']}));});
  api.listen(0,'127.0.0.1');await new Promise(r=>api.once('listening',r));
  const template=await fs.readFile(path.resolve(__dirname,'../deploy/nginx-public.conf'),'utf8');
  const config=template.replace('listen 80;',`listen 127.0.0.1:${httpPort};`).replace('listen 443 ssl;',`listen 127.0.0.1:${tlsPort} ssl;`).replaceAll('server_name gusto-thadingyut-festival.eddiespace.com;','server_name localhost;').replaceAll('/srv/king-queen-voting/current',dir).replace('/etc/letsencrypt/live/gusto-thadingyut-festival.eddiespace.com/fullchain.pem',path.join(dir,'cert.pem')).replace('/etc/letsencrypt/live/gusto-thadingyut-festival.eddiespace.com/privkey.pem',path.join(dir,'key.pem')).replace('http://127.0.0.1:5000',`http://127.0.0.1:${api.address().port}`);
  const file=path.join(dir,'nginx.conf');await fs.writeFile(file,`pid ${dir}/nginx.pid;\nerror_log ${dir}/error.log;\nevents {worker_connections 64;}\nhttp {access_log off;\n${config}\n}\n`);
  const binary=process.env.NGINX_BINARY||'nginx';
  execFileSync(binary,['-t','-p',dir,'-c',file],{stdio:'pipe'});
  nginx=spawn(binary,['-p',dir,'-c',file,'-g','daemon off;'],{stdio:'ignore'});exited=new Promise(r=>nginx.once('exit',r));
  async function tls(url,headers={}) {return new Promise((resolve,reject)=>{https.get({hostname:'localhost',family:4,port:tlsPort,path:url,ca,headers},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));}).on('error',reject);});}
  for(let n=0;;n++){try{await tls('/');break;}catch(e){if(n>30||nginx.exitCode!==null)throw e;await new Promise(r=>setTimeout(r,100));}}
  const redirect=await fetch(`http://127.0.0.1:${httpPort}/privacy?test=1`,{redirect:'manual'});assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'https://gusto-thadingyut-festival.eddiespace.com/privacy?test=1');
  for(const url of ['/','/privacy','/admin/']){const response=await tls(url);assert.equal(response.status,200);assert.match(response.body,/id="root"/);assert.equal(response.headers['cross-origin-opener-policy'],'same-origin-allow-popups');assert.match(response.headers['strict-transport-security'],/max-age/);}
  const response=await tls('/api/v1/auth/config',{'X-Forwarded-For':'203.0.113.8','CF-Connecting-IP':'203.0.113.9'});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['x-content-type-options'],'nosniff');assert.match(response.headers['strict-transport-security'],/max-age/);
  const proxied=JSON.parse(response.body);assert.equal(proxied.forwarded,'127.0.0.1');assert.equal(proxied.protocol,'https');assert.equal(proxied.host,'localhost');
  assert.equal((await tls('/api/v1/health/ready')).status,403);assert.equal((await tls('/api/v1/health/ready/')).status,403);assert.equal((await tls('/.env')).status,403);
  console.log('Nginx public template passed: syntax, canonical HTTPS redirect, TLS, homepage/admin/privacy routes, auth no-store headers, private readiness and spoofed-IP rejection. Temporary local server only.');
 }finally{if(nginx?.pid&&nginx.exitCode===null){nginx.kill('SIGTERM');await exited;}if(api)await new Promise(r=>api.close(r));await fs.rm(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
