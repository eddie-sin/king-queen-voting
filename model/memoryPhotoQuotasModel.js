const mongoose = require("mongoose");

// Both accepted IDs and in-flight reservations occupy slots. Successful IDs
// remain here permanently, regardless of moderation status or image deletion.
const memoryPhotoQuotaSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  slots: [{ type: mongoose.Schema.Types.ObjectId, ref: "MemoryPhoto" }],
});

module.exports = mongoose.model("MemoryPhotoQuota", memoryPhotoQuotaSchema);
