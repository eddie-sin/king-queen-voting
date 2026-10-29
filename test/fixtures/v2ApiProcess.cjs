// Owned by v2Fixture.cjs. Never load dotenv or application environment files.
const mongoose = require('mongoose');
const uri = process.env.TEST_V2_URI;
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/test_v2_[a-f0-9]{12}\?replicaSet=testV2$/.test(uri || '')) process.exit(1);
require('@aws-sdk/client-s3').S3Client.prototype.send = async () => { throw Error('Live AWS forbidden in v2 regression fixture'); };
const app = require('../../app');
mongoose.connect(uri, { autoCreate: false, autoIndex: false })
  .then(() => require('../../utils/seed').seed())
  .then(() => { const server = app.listen(0, '127.0.0.1', () => process.send({ ready: true, port: server.address().port })); })
  .catch(error => { process.send({ ready: false, reason: error.message }); process.exit(1); });
