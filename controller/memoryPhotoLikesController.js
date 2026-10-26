const mongoose = require("mongoose");
const MemoryPhoto = require("../model/memoryPhotosModel");
const Like = require("../model/memoryPhotoLikesModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");

exports.getLikeStatus = catchAsync(async (req, res) => {
  // Reject even empty JSON bodies and unparsed body types on this read-only API.
  if (req.headers["transfer-encoding"] || Number(req.headers["content-length"] || 0) > 0
    || req.body !== undefined || Object.keys(req.query).some((key) => key !== "photoIds")
    || typeof req.query.photoIds !== "string") {
    throw new AppError("Provide only a photoIds query parameter and no request body.", 400);
  }
  const ids = req.query.photoIds.split(",");
  if (ids.length < 1 || ids.length > 50 || ids.some((id) => !/^[a-f0-9]{24}$/i.test(id))
    || new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) {
    throw new AppError("photoIds must contain 1–50 unique valid photo IDs.", 400);
  }
  const approved = await MemoryPhoto.find({ _id: { $in: ids }, status: "APPROVED", archived: { $ne: true }, deletedAt: { $exists: false } }).select("_id").lean();
  const approvedIds = new Set(approved.map((photo) => String(photo._id)));
  const likes = approved.length ? await Like.find({ userId: req.userId, photoId: { $in: approved.map((photo) => photo._id) } })
    .select("photoId -_id").lean() : [];
  const likedIds = new Set(likes.map((like) => String(like.photoId)));
  const photos = ids.map((id) => id.toLowerCase()).filter((id) => approvedIds.has(id))
    .map((photoId) => ({ photoId, liked: likedIds.has(photoId) }));
  res.status(200).json({ status: "success", results: photos.length, data: { photos } });
});

const setLiked = (liked) => catchAsync(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    throw new AppError("A valid Memory Photo ID is required.", 400);
  }
  if (Object.keys(req.body || {}).length || Object.keys(req.query).length) {
    throw new AppError("Like requests do not accept body or query fields.", 400);
  }
  if (!(await MemoryPhoto.exists({ _id: req.params.id, status: "APPROVED", archived: { $ne: true }, deletedAt: { $exists: false } }))) {
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
