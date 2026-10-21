const mongoose = require("mongoose");
const { pipeline } = require("node:stream/promises");
const MemoryPhoto = require("../model/memoryPhotosModel");
const storage = require("../utils/memoryPhotoStorage");
const clock = require("../utils/clock");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

const photoId = (req) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    throw new AppError("A valid Memory Photo ID is required.", 400);
  }
  return req.params.id;
};

const photoResponse = (photo) => ({
  id: photo._id,
  owner: photo.owner,
  status: photo.status,
  createdAt: photo.createdAt,
  reviewedBy: photo.reviewedBy,
  reviewedAt: photo.reviewedAt,
});

exports.listPending = catchAsync(async (req, res) => {
  const photos = await MemoryPhoto.find({ status: "PENDING" })
    .select("_id owner status createdAt reviewedBy reviewedAt").sort({ createdAt: -1, _id: -1 }).lean();
  res.status(200).json({ status: "success", results: photos.length,
    data: { photos: photos.map(photoResponse) } });
});

exports.getImage = catchAsync(async (req, res) => {
  const photo = await MemoryPhoto.findById(photoId(req)).select("imageKey").lean();
  if (!photo) throw new AppError("Memory Photo not found.", 404);
  let image;
  try { image = await storage.getImage(photo.imageKey); } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) throw error;
    throw new AppError("Could not retrieve the Memory Photo image. Please retry.", 503);
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(image.contentType)
    || (!Buffer.isBuffer(image.body) && typeof image.body?.pipe !== "function")) {
    if (typeof image.body?.destroy === "function") image.body.destroy();
    throw new AppError("Could not retrieve the Memory Photo image. Please retry.", 503);
  }
  res.set({
    "Content-Type": image.contentType,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  });
  res.vary("Authorization");
  if (Buffer.isBuffer(image.body)) return res.status(200).send(image.body);
  if (Number.isSafeInteger(image.contentLength) && image.contentLength >= 0) {
    res.set("Content-Length", String(image.contentLength));
  }
  try { await pipeline(image.body, res); } catch {
    // pipeline closes both ends on stream failure/client disconnect. Never send
    // provider errors or attempt a JSON response after partial image delivery.
    res.destroy();
  }
});

exports.reviewPhoto = catchAsync(async (req, res) => {
  const id = photoId(req);
  const body = req.body || {};
  if (Object.keys(body).length !== 1 || !["APPROVED", "REJECTED"].includes(body.status)) {
    throw new AppError("Provide only status: APPROVED or REJECTED.", 400);
  }
  const photo = await MemoryPhoto.findOneAndUpdate({ _id: id, status: "PENDING" }, {
    $set: { status: body.status, reviewedBy: req.admin._id, reviewedAt: clock.now() },
  }, { returnDocument: "after", runValidators: true })
    .select("_id owner status createdAt reviewedBy reviewedAt").lean();
  if (!photo) {
    if (!(await MemoryPhoto.exists({ _id: id }))) throw new AppError("Memory Photo not found.", 404);
    throw new AppError("This Memory Photo has already been reviewed.", 409);
  }
  res.status(200).json({ status: "success", data: { photo: photoResponse(photo) } });
});
