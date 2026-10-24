const mongoose = require('mongoose');
const { PERMISSIONS } = require('../utils/permissions');
const schema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 100 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'voting_admin'], required: true },
  permissions: { type: [String], default: [], validate: value => new Set(value).size === value.length && value.every(p => PERMISSIONS.includes(p)) },
  status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  tokenVersion: { type: Number, default: 0, min: 0 },
}, { timestamps: true });
module.exports = mongoose.model('Admin', schema);
