const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  storageKey: { type: String, required: true, immutable: true },
  uploadId: { type: String, required: true, immutable: true },
  photoId: { type: mongoose.Schema.Types.ObjectId, ref: "MemoryPhoto", required: true, immutable: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  reservationFingerprint: { type: String, required: true, immutable: true, select: false },
  reservationExpiresAt: { type: Date, required: true, immutable: true },
  sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true },
  contentType: { type: String, required: true, enum: ["image/webp"], immutable: true },
  byteLength: { type: Number, required: true, min: 1, immutable: true },
  width: { type: Number, required: true, min: 1, immutable: true },
  height: { type: Number, required: true, min: 1, immutable: true },
  state: { type: String, required: true, enum: ["allocated", "uploading", "uploaded", "committed", "uncertain", "orphan_candidate", "compensating", "deleted"], default: "allocated" },
  uploadingAt: { type: Date, default: null },
  uncertainSince: { type: Date, default: null },
  orphanCandidateAt: { type: Date, default: null },
  compensatingAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ storageKey: 1 }, { unique: true });
schema.index({ uploadId: 1 }, { unique: true });
schema.index({ photoId: 1, reservationFingerprint: 1 }, { unique: true });

module.exports = mongoose.model("MemoryPhotoStorageObject", schema);
