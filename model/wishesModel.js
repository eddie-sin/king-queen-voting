const mongoose = require("mongoose");

const wishSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, select: false },
  slot: { type: Number, required: true, enum: [1, 2, 3], select: false },
  message: { type: String, required: true, trim: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },
});

// Three fixed slots enforce the account limit even for concurrent requests.
wishSchema.index({ user: 1, slot: 1 }, { unique: true });
wishSchema.index({ createdAt: -1, _id: -1 });

module.exports = mongoose.model("Wish", wishSchema);
