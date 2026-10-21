const mongoose = require("mongoose");
const Election = require("../model/electionModel");
const MemoryPhoto = require("../model/memoryPhotosModel");
const quota = require("../utils/memoryPhotoQuota");
const storage = require("../utils/memoryPhotoStorage");
const validateImage = require("../utils/validateMemoryPhoto");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");

const requireEnabled = async () => {
  const election = await Election.findById("election").select("memoryPhotosEnabled").lean();
  if (election?.memoryPhotosEnabled !== true) throw new AppError("Memory Photo submissions are disabled.", 403);
};

exports.requireEnabled = catchAsync(async (req, res, next) => {
  await requireEnabled();
  next();
});

exports.submitPhoto = catchAsync(async (req, res) => {
  if (req.files?.length !== 1) throw new AppError("Please upload exactly one image using the images field.", 400);
  if (Object.keys(req.body || {}).length) throw new AppError("Only an image may be submitted.", 400);
  const file = await validateImage(req.files[0]);
  const photoId = new mongoose.Types.ObjectId();
  let imageKey;
  try {
    await quota.reserve(req.userId, photoId);
    imageKey = await storage.uploadImage(file);
    // Do not accept a submission if an admin disabled the feature during upload.
    await requireEnabled();
    const photo = new MemoryPhoto({ _id: photoId, owner: req.userId, imageKey, status: "PENDING" });
    await photo.save({ writeConcern: { w: "majority", j: true } });
    return res.status(201).json({ status: "success", data: { photo: {
      id: photo._id, status: photo.status, createdAt: photo.createdAt,
    } } });
  } catch (error) {
    // A rejected conditional reservation did not allocate a slot or start an insert.
    if (error instanceof AppError && error.statusCode === 409) throw error;
    let safeToRelease = false;
    try {
      await quota.cancel(req.userId, photoId);
      safeToRelease = true;
    } catch { /* An uncertain cancellation must retain both slot and image. */ }
    if (safeToRelease) {
      if (imageKey) {
        try { await storage.deleteImage(imageKey); } catch {
          console.error("Memory Photo image cleanup needs reconciliation.");
        }
      }
      try { await quota.release(req.userId, photoId); } catch {
        console.error("Memory Photo quota cleanup needs reconciliation.");
      }
    } else {
      console.error("Memory Photo persistence needs reconciliation; quota retained.");
    }
    // Never include storage errors, private keys or database documents in API errors.
    if (error instanceof AppError && [403, 409].includes(error.statusCode)) throw error;
    throw new AppError("Could not accept the Memory Photo submission. Please retry.", 503);
  }
});
