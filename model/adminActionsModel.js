const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  operationId: { type: String, required: true, unique: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  actorName: { type: String, required: true },
  action: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false } });
module.exports = mongoose.model('AdminAction', schema);
