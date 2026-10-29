// Owned by v2Fixture.cjs. Runs the real recovery helper in a fresh process so
// restart/reconciliation behavior is tested without sharing Mongoose state.
const mongoose = require('mongoose');
const uri = process.env.TEST_V2_URI;
const owner = process.env.TEST_V2_OWNER;
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/test_v2_[a-f0-9]{12}\?replicaSet=testV2$/.test(uri || '')
  || !/^[a-f0-9]{24}$/i.test(owner || '')) process.exit(1);
mongoose.connect(uri, { autoCreate: false, autoIndex: false })
  .then(() => require('../../utils/memoryPhotoQuota').recoverCancelled(owner))
  .then(async () => { await mongoose.disconnect(); process.exit(0); })
  .catch(async () => { try { await mongoose.disconnect(); } catch {} process.exit(1); });
