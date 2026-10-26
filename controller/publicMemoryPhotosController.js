const mongoose = require("mongoose");
const { pipeline } = require("node:stream/promises");
const Controls = require("../model/eventControlsModel");
const MemoryPhoto = require("../model/memoryPhotosModel");
const Like = require("../model/memoryPhotoLikesModel");
const storage = require("../utils/memoryPhotoStorage");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");

const requireEnabled = async () => {
  const election = await Controls.findById("event").select("memoryPhotosEnabled").lean();
  if (election?.memoryPhotosEnabled !== true) throw new AppError("Memory Photo is disabled.", 403);
};

// Apply even to denied/error responses. No validator or 304 response may bypass
// a fresh database feature/approval check on a subsequent image request.
exports.publicAccess = catchAsync(async (req, res, next) => {
  res.set({
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "X-Content-Type-Options": "nosniff",
  });
  await requireEnabled();
  next();
});

const pageNumber = (value, fallback, maximum, name) => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)
    || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) {
    throw new AppError(`${name} must be an integer between 1 and ${maximum}.`, 400);
  }
  return Number(value);
};

exports.listApproved = catchAsync(async (req, res) => {
  if (Object.keys(req.query).some((key) => !["page", "limit"].includes(key))) {
    throw new AppError("Only page and limit query parameters are supported.", 400);
  }
  const page = pageNumber(req.query.page, 1, 1000, "page");
  const limit = pageNumber(req.query.limit, 20, 50, "limit");
  const photos = await MemoryPhoto.find({ status: "APPROVED" }).select("_id createdAt")
    .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).lean();
  const pagePhotos = photos.slice(0, limit);
  const counts = pagePhotos.length ? await Like.aggregate([
    { $match: { photoId: { $in: pagePhotos.map((photo) => photo._id) } } },
    { $group: { _id: "$photoId", count: { $sum: 1 } } },
  ]) : [];
  const countById = new Map(counts.map((entry) => [String(entry._id), entry.count]));
  await requireEnabled();
  const visible = pagePhotos.map((photo) => ({
    id: photo._id, createdAt: photo.createdAt, likeCount: countById.get(String(photo._id)) || 0,
  }));
  res.status(200).json({ status: "success", results: visible.length,
    pagination: { page, limit, hasMore: page < 1000 && photos.length > limit }, data: { photos: visible } });
});

exports.getApprovedImage = catchAsync(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    throw new AppError("A valid Memory Photo ID is required.", 400);
  }
  const filter = { _id: req.params.id, status: "APPROVED" };
  const photo = await MemoryPhoto.findOne(filter).select("imageKey").lean();
  // Use the same response for absent, pending and rejected records.
  if (!photo) throw new AppError("Memory Photo not found.", 404);
  let image;
  try { image = await storage.getImage(photo.imageKey); } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) throw error;
    throw new AppError("Could not retrieve the Memory Photo image. Please retry.", 503);
  }
  try {
    // Storage reads may be slow. Recheck immediately before delivering bytes.
    await requireEnabled();
    if (!(await MemoryPhoto.exists(filter))) throw new AppError("Memory Photo not found.", 404);
    if (!["image/jpeg", "image/png", "image/webp"].includes(image?.contentType)
      || (!Buffer.isBuffer(image.body) && typeof image.body?.pipe !== "function")) {
      throw new AppError("Could not retrieve the Memory Photo image. Please retry.", 503);
    }
  } catch (error) {
    if (typeof image?.body?.destroy === "function") image.body.destroy();
    throw error;
  }
  res.set({ "Content-Type": image.contentType, "Content-Disposition": "inline" });
  // res.end avoids Express-generated ETags and conditional 304 responses.
  if (Buffer.isBuffer(image.body)) {
    res.set("Content-Length", String(image.body.length));
    return res.status(200).end(image.body);
  }
  if (Number.isSafeInteger(image.contentLength) && image.contentLength >= 0) {
    res.set("Content-Length", String(image.contentLength));
  }
  try { await pipeline(image.body, res); } catch {
    res.destroy();
  }
});
