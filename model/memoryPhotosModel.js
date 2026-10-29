const mongoose = require("mongoose");

const memoryPhotoSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  // Store an opaque storage reference, not an assumed public image URL.
  imageKey: { type: String, required: function () { return !this.cancelled && !this.deletedAt && this.status !== "REJECTED"; }, trim: true },
  // Permanent same-ID fence for failed inserts; never expose as a submission.
  cancelled: { type: Boolean, default: false, select: false },
  status: {
    type: String,
    enum: ["PENDING", "APPROVED", "REJECTED"],
    default: "PENDING",
    required: true,
  },
  createdAt: { type: Date, default: Date.now, required: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  reviewedAt: { type: Date },
  archived: { type: Boolean, default: false },
  archivedAt: { type: Date },
  archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  deletedAt: { type: Date },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  storageDeletedAt: { type: Date },
  cleanupPending: { type: Boolean, default: false, select: false },
});

for (const operation of ["find", "findOne", "findOneAndUpdate", "countDocuments"]) {
  memoryPhotoSchema.pre(operation, function () {
    this.where({ cancelled: { $ne: true } });
  });
}

// Retain moderation history, while quota occupancy is tracked separately for
// pending/approved active photos in MemoryPhotoQuota.
memoryPhotoSchema.index({ owner: 1, createdAt: -1 });
memoryPhotoSchema.index({ status: 1, archived: 1, createdAt: -1 });

module.exports = mongoose.model("MemoryPhoto", memoryPhotoSchema);
