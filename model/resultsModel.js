const mongoose = require("mongoose");

const finalistSchema = new mongoose.Schema(
  {
    candidate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Candidate",
      required: true,
    },
    votes: { type: Number, required: true },
    selectedByTieBreak: { type: Boolean, default: false },
  },
  { _id: false },
);

const resultsSchema = new mongoose.Schema({
  _id: { type: String, default: "election" },
  kings: [finalistSchema],
  queens: [finalistSchema],
  finalizedAt: { type: Date, required: true },
});

module.exports = mongoose.model("Results", resultsSchema);
