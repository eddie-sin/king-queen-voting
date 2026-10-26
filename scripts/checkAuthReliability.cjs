// Recovery/lease/shutdown checks on a disposable database with an in-memory provider.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
Object.assign(process.env, {NODE_ENV:'test',AUTH_TEST_MODE:'true',AUTH_ENVIRONMENT:'local',AUTH_ORIGIN:'http://localhost:5173',AUTH_OTP_SECRET:crypto.randomBytes(32).toString('hex'),AUTH_MAIL_SECRET:crypto.randomBytes(32).toString('hex')});
const {Mail,Flow,Limit} = require('../model/studentAuthModels');
const Controls = require('../model/eventControlsModel');
const worker = require('../utils/accounts/mail');
const security = require('../utils/accounts/security');
const db = 'kqv_reliability_' + crypto.randomBytes(8).toString('hex');
async function job(extra = {}) {
  const id = security.random();
  await Flow.create({_id:id,browser:'fake',purpose:'register',emailKey:'fake@gmail.com',expiresAt:new Date(Date.now()+600000)});
  return Mail.create({_id:id,flow:id,payload:security.seal({from:'fake',to:['fake'],text:'fake'}),budgetDay:new Date().toISOString().slice(0,10),expiresAt:new Date(Date.now()+600000),...extra});
}
async function main() {
  await mongoose.connect(process.env.AUTH_TEST_MONGO_URI.replace('/?', `/${db}?`));
  try {
    for (const model of Object.values(mongoose.models)) await model.init();
    await Controls.create({_id:'event'});
    await assert.rejects(worker.tick(), /Real email/);
    let sends = 0;
    const fake = async () => {sends++;return {ok:true,id:'fake'};};
    const leased = await job({status:'sending',attempts:1,leaseUntil:new Date(Date.now()+30000)});
    await worker.tick(fake);assert.equal(sends,0);
    await Mail.updateOne({_id:leased._id},{$set:{leaseUntil:new Date(0)}});
    await worker.tick(fake);assert.equal(sends,1);assert.equal((await Mail.findById(leased._id)).status,'sent');
    const poison = await job({payload:'corrupt encrypted data'});
    await worker.tick(fake);assert.equal(sends,1);assert.equal((await Mail.findById(poison._id)).errorCode,'payload');
    const expiry = await job({expiresAt:new Date(0)});
    await worker.tick(fake);assert.equal(sends,1);assert.equal((await Mail.findById(expiry._id)).status,'expired');
    const exhausted = await job({status:'sending',attempts:4,leaseUntil:new Date(0)});
    await worker.tick(fake);assert.equal(sends,1);assert.equal((await Mail.findById(exhausted._id)).errorCode,'attempts');
    const retry = await job();const ids=[];
    for(let n=0;n<4;n++) {
      await Mail.updateOne({_id:retry._id},{$set:{nextAt:new Date(0)}});
      await worker.tick(async (_,id) => {ids.push(id);return {ok:false,status:503};});
    }
    assert.equal(new Set(ids).size,1);assert.equal(ids.length,4);assert.equal((await Mail.findById(retry._id)).status,'failed');
    assert.equal(await Mail.countDocuments({status:{$in:['failed','sent','expired']},payload:{$exists:true}}),0);
    const month = await job({budgetDay:'2000-01-01'});
    const current = new Date().toISOString().slice(0,7);
    await Limit.updateOne({_id:`mail-month:${current}`},{$set:{count:3000,until:new Date(Date.now()+3600000)}},{upsert:true});
    await worker.tick(fake);assert.equal((await Mail.findById(month._id)).errorCode,'quota');assert.equal(sends,1);
    // stop() waits for the in-flight delivery and prevents a second lease.
    await job();let release, entered;
    const waiting = new Promise(r=>{entered=r;});
    const active = worker.tick(async()=>{entered();await new Promise(r=>{release=r;});return {ok:true,id:'drained'};});
    await waiting;let drained=false;
    const stop = worker.stop().then(()=>{drained=true;});
    await new Promise(r=>setImmediate(r));assert.equal(drained,false);
    release();await active;await stop;assert.equal(drained,true);
    console.log('Mail reliability passed: test transport guard, restart lease recovery, poison/expired payload removal, stable retry IDs, four-attempt ceiling, monthly rollover quota and shutdown drain. Real emails: 0.');
  } finally {await mongoose.connection.dropDatabase();await mongoose.disconnect();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
