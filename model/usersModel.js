const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  emailKey: { type: String, required: true, unique: true },
  emailVerifiedAt: { type: Date, required: true },
  googleSub: { type: String, select: false },
  passwordHash: { type: String, select: false },
  status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  tokenVersion: { type: Number, default: 0, min: 0 },
}, { timestamps: true });
schema.index({ googleSub: 1 }, { unique: true, partialFilterExpression: { googleSub: { $type: 'string' } } });
module.exports = mongoose.model('User', schema);
