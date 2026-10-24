
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },

  passwordHash: {
    type: String,
    required: true,
    select: false,
  },

  credentialIssued: {
    type: Boolean,
    default: false,
  },

  emailVerified: {
    type: Boolean,
    default: false,
  },

  emailOtpHash: {
    type: String,
    select: false,
  },

  emailOtpExpires: {
    type: Date,
    select: false,
    
  },
    pendingVotingKeyEncrypted: {
    type: String,
    select: false,
  },

  pendingVotingKeyExpires: {
    type: Date,
    select: false,
  },

  hasVotedKing: { type: Boolean, default: false },
  hasVotedQueen: { type: Boolean, default: false },

  status: {
    type: String,
    enum: ["active", "disabled"],
    default: "active",
  },
});

module.exports = mongoose.model("User", userSchema);
