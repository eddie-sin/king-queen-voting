// Isolated local development database; never changes the shared MongoDB service.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MongoClient } = require('mongoose').mongo;
const directory = path.join(os.homedir(), '.local', 'share', 'king-queen-voting-v2');
const uri = 'mongodb://127.0.0.1:27018/?directConnection=true';
async function connect() { const client = new MongoClient(uri, { serverSelectionTimeoutMS: 1500 }); await client.connect(); return client; }
async function main() {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let client;
  try { client = await connect(); }
  catch {
    const result = spawnSync('mongod', ['--bind_ip','127.0.0.1','--port','27018','--replSet','kqvLocal','--dbpath',directory,'--logpath',path.join(directory,'mongod.log'),'--fork'], { encoding:'utf8' });
    if (result.status !== 0) throw new Error('Could not start isolated MongoDB. Inspect the private mongod.log; port 27018 may be occupied.');
    client = await connect();
  }
  try {
    const admin = client.db('admin');
    let status;
    try { status = await admin.command({ replSetGetStatus: 1 }); }
    catch (error) {
      if (error.code !== 94) throw error;
      // Refuse to initialize an occupied port containing unrelated databases.
      const options = await admin.command({ getCmdLineOpts: 1 });
      if (path.resolve(options.parsed?.storage?.dbPath || '') !== directory) throw new Error('Port 27018 is not this project’s isolated server; no configuration changed.');
      await admin.command({ replSetInitiate: { _id:'kqvLocal', members:[{_id:0,host:'127.0.0.1:27018'}] } });
    }
    if (status && status.set !== 'kqvLocal') throw new Error('Port 27018 belongs to another replica set.');
    for (let attempt=0;attempt<40;attempt++) {
      if ((await admin.command({hello:1})).isWritablePrimary) { console.log('Local v2 MongoDB ready on 127.0.0.1:27018 (kqvLocal).'); return; }
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw new Error('Replica set has not become ready. Retry shortly.');
  } finally { await client.close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
