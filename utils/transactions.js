const mongoose = require('mongoose');
// The callback may be retried: database work only, no uploads or external effects.
exports.transaction = callback => mongoose.connection.transaction(callback, {
  readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' },
  readPreference: 'primary', maxCommitTimeMS: 2500, timeoutMS: 12000,
});
