const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
  contest: { type: String, enum: ['king', 'queen'], required: true },
  round: { type: Number, required: true, min: 1 },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ round: 1, user: 1, contest: 1 }, { unique: true });
schema.index({ round: 1, candidate: 1 });
module.exports = mongoose.model('Ballot', schema);
