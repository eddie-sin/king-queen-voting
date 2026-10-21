const mongoose = require("mongoose");

const memoryPhotoLikeSchema = new mongoose.Schema({
  photoId: { type: mongoose.Schema.Types.ObjectId, ref: "MemoryPhoto", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now, required: true },
});

memoryPhotoLikeSchema.index({ photoId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("MemoryPhotoLike", memoryPhotoLikeSchema);
