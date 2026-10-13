const mongoose = require("mongoose");

const ballotSchema = new mongoose.Schema({
  credential: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "VotingCredential",
    required: [true, "Voting credential is required"],
  },
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Candidate",
    required: [true, "Candidate is required"],
  },
  contest: {
    type: String,
    required: [true, "Contest is required"],
    enum: ["king", "queen"],
  },
});

// One current King vote and one current Queen vote per anonymous credential.
ballotSchema.index({ credential: 1, contest: 1 }, { unique: true });

module.exports = mongoose.model("Ballot", ballotSchema);
