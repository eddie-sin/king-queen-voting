const mongoose = require("mongoose");

const memoryPhotoLikeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  photoId: { type: mongoose.Schema.Types.ObjectId, ref: "MemoryPhoto", required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

memoryPhotoLikeSchema.index({ userId: 1, photoId: 1 }, { unique: true });
memoryPhotoLikeSchema.index({ photoId: 1 });

module.exports = mongoose.model("MemoryPhotoLike", memoryPhotoLikeSchema);
