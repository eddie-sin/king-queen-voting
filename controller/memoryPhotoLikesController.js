const mongoose = require("mongoose");
const MemoryPhoto = require("../model/memoryPhotosModel");
const Like = require("../model/memoryPhotoLikesModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");

const setLiked = (liked) => catchAsync(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    throw new AppError("A valid Memory Photo ID is required.", 400);
  }
  if (Object.keys(req.body || {}).length || Object.keys(req.query).length) {
    throw new AppError("Like requests do not accept body or query fields.", 400);
  }
  if (!(await MemoryPhoto.exists({ _id: req.params.id, status: "APPROVED" }))) {
    throw new AppError("Memory Photo not found.", 404);
  }
  // Also await initialization for consumers that mount app.js without server.js.
  // The database index, not an application check, enforces duplicate prevention.
  await Like.init();
  const filter = { photoId: req.params.id, userId: req.userId };
  if (liked) {
    try {
      await Like.updateOne(filter, { $setOnInsert: filter }, { upsert: true, runValidators: true });
    } catch (error) {
      if (error.code !== 11000 || !error.keyPattern?.photoId || !error.keyPattern?.userId) throw error;
      // A competing upsert already created this user's like: same successful outcome.
    }
  } else {
    await Like.deleteOne(filter);
  }
  const likeCount = await Like.countDocuments({ photoId: req.params.id });
  res.status(200).json({ status: "success", data: {
    photoId: req.params.id, liked, likeCount,
  } });
});

exports.likePhoto = setLiked(true);
exports.unlikePhoto = setLiked(false);
