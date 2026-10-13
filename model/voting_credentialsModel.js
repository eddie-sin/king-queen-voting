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
});

module.exports = mongoose.model("VotingCredential", votingCredentialSchema);
