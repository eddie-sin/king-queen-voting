const mongoose = require("mongoose");

const electionSchema = new mongoose.Schema({
  _id: { type: String, default: "election" },
  registrationClosesAt: { type: Date, required: true },
  candidateManagementClosesAt: { type: Date, required: true },
  votingOpensAt: { type: Date, required: true },
  votingClosesAt: { type: Date, required: true },
  resultsPublishedAt: { type: Date, required: true },
  votingOverride: {
    type: String,
    enum: ["auto", "open", "closed"],
    default: "auto",
  },
  candidateManagementLocked: { type: Boolean, default: false },
});

electionSchema.pre("validate", function () {
  if (this.candidateManagementClosesAt && this.votingOpensAt && this.candidateManagementClosesAt > this.votingOpensAt) {
    this.invalidate(
      "candidateManagementClosesAt",
      "Candidate management deadline must not be after voting opens.",
    );
  }
  if (!(this.votingOpensAt < this.votingClosesAt)) {
    this.invalidate("votingClosesAt", "Voting must close after it opens.");
  }
  if (!(this.resultsPublishedAt > this.votingClosesAt)) {
    this.invalidate(
      "resultsPublishedAt",
      "Results must appear after voting closes.",
    );
  }
});

module.exports = mongoose.model("Election", electionSchema);
