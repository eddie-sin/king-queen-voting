const mongoose = require("mongoose");

const votingCredentialSchema = new mongoose.Schema({
  codeHash: {
    type: String,
    required: [true, "Code hash is required"],
    unique: true,
  },
  status: {
    type: String,
    enum: ["active", "revoked"],
    default: "active",
  },
  // Legacy, unbound credentials have no stored version and are never claimed.
  bindingVersion: { type: Number, enum: [2], default: 2, required: true },
});

module.exports = mongoose.model("VotingCredential", votingCredentialSchema);
