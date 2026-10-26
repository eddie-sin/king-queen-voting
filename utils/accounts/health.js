const mongoose = require('mongoose');
const { settings, validate } = require('./config');
const { Mail, Limit } = require('../../model/studentAuthModels');
const Controls = require('../../model/eventControlsModel');
exports.readiness = async () => {
  validate();
  const hello = await mongoose.connection.db.admin().command({hello:1, maxTimeMS:2000});
  const controls = await Controls.findById('event').select('schemaVersion').maxTimeMS(2000).lean();
  if ((!hello.setName && hello.msg !== 'isdbgrid') || controls?.schemaVersion !== 2) throw new Error('Database schema is not ready');
  return { ready:true, schemaVersion:2, authenticationVersion:1, environment:settings().environment };
};
exports.report = async () => {
  const readiness = await exports.readiness();
  const now = new Date(), day = now.toISOString().slice(0,10), month = day.slice(0,7);
  const jobs = await Mail.aggregate([{$match:{expiresAt:{$gt:now}}},{$group:{_id:'$status',count:{$sum:1}}}]).option({maxTimeMS:2000});
  const limits = await Limit.find({_id:{$in:[`mail-day:${day}`,`mail-month:${month}`,'mail-pause']}}).select('count until').maxTimeMS(2000).lean();
  const count = id => limits.find(x=>x._id===id)?.count || 0;
  return {...readiness, checkedAt:now.toISOString(), queue:Object.fromEntries(jobs.map(x=>[x._id,x.count])), reserved:{day:count(`mail-day:${day}`),month:count(`mail-month:${month}`)}, providerPausedUntil:limits.find(x=>x._id==='mail-pause' && x.until>now)?.until || null};
};
if (require.main === module) {
  const file = process.argv[2];
  if (!file) {console.error('Provide the path to the protected config.env file.');process.exitCode=1;}
  else (async()=>{
    require('dotenv').config({path:file,quiet:true});
    let uri=process.env.DATABASE;
    if(process.env.NODE_ENV==='development')uri=process.env.DATABASE_LOCAL;
    if(typeof uri!=='string')throw new Error('Database configuration missing');
    uri=uri.replace('<db_password>',encodeURIComponent(process.env.DATABASE_PASSWORD||''));
    await mongoose.connect(uri,{autoCreate:false,autoIndex:false,serverSelectionTimeoutMS:5000});
    console.log(JSON.stringify(await exports.report(),null,2));
  })().catch(()=>{console.error('Authentication readiness check failed. Inspect protected configuration, replica health and schema. No data was changed.');process.exitCode=1;}).finally(()=>mongoose.disconnect());
}
