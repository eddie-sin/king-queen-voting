// One new replica set, random ports, fake credentials; no configuration file is loaded.
const { spawn } = require('node:child_process');
const { start } = require('../test/helpers/replica.cjs');
async function main() {
  const mongo = await start();
  try {
    let browserRun=0;
    for (const script of ['checkGoogleVerification.cjs','checkStudentAuth.cjs','checkStaffLantern.cjs','checkAuthReliability.cjs','checkHttpsAuth.cjs', ...(process.argv.includes('--no-browser') ? [] : ['checkStudentAuthBrowser.cjs','checkStudentAuthBrowser.cjs'])]) {
      await new Promise((resolve,reject) => {
        const child = spawn(process.execPath, [require('node:path').join(__dirname,script)], {stdio:'inherit',env:{...process.env,AUTH_BROWSER:script==='checkStudentAuthBrowser.cjs' && browserRun++ ? 'webkit' : 'chrome',AUTH_TEST_MODE:'true',AUTH_ENVIRONMENT:'local',AUTH_TEST_MONGO_URI:mongo.uri}});
        child.once('error',reject);child.once('exit',code => code === 0 ? resolve() : reject(new Error(`${script} failed (${code})`)));
      });
    }
  } finally { await mongo.close(); }
}
main().catch(e => {console.error(e.message);process.exitCode=1;});
