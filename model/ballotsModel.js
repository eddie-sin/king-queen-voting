
const mongoose = require("mongoose");

const ballotSchema = new mongoose.Schema({
  credential: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "VotingCredential",
    required: true,
  },

  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Candidate",
    required: true,
  },

  contest: {
    type: String,
    enum: ["king", "queen"],
    required: true,
  },
});

// One vote per credential for each category
ballotSchema.index(
  { credential: 1, contest: 1 },
  { unique: true }
);

module.exports = mongoose.model("Ballot", ballotSchema);
