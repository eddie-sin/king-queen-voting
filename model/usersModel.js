const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  tokenVersion: { type: Number, default: 0, min: 0 },
}, { timestamps: true });
module.exports = mongoose.model('User', schema);
