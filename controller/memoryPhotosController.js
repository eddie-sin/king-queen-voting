const mongoose = require("mongoose");
const Controls = require("../model/eventControlsModel");
const MemoryPhoto = require("../model/memoryPhotosModel");
const MemoryPhotoQuota = require("../model/memoryPhotoQuotasModel");
const quota = require("../utils/memoryPhotoQuota");
const storage = require("../utils/memoryPhotoStorage");
const validateImage = require("../utils/validateMemoryPhoto");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");

const requireEnabled = async () => {
  const election = await Controls.findById("event").select("memoryPhotosEnabled").lean();
  if (election?.memoryPhotosEnabled !== true) throw new AppError("Memory Photo submissions are disabled.", 403);
};

exports.requireEnabled = catchAsync(async (req, res, next) => {
  await requireEnabled();
  next();
});

exports.listMine = catchAsync(async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.vary("Cookie");
  if (Object.keys(req.query).length || Object.keys(req.body || {}).length) {
    throw new AppError("My Memories does not accept body or query fields.", 400);
  }
  // Model query middleware excludes permanent cancellation fences, including
  // fences created by converting an ambiguously committed insert.
  const photos = await MemoryPhoto.find({ owner: req.userId, deletedAt: { $exists: false } })
    .select("_id status createdAt archived deletedAt").sort({ createdAt: -1, _id: -1 }).lean();
  const usage = await MemoryPhotoQuota.findById(req.userId).select("slots").lean();
  // Include legacy photos before quota initialization, and never advertise a
  // free slot already occupied by an unresolved reservation or retained history.
  const released = usage?.slots?.length ? new Set((await MemoryPhoto.collection.find({ _id: { $in: usage.slots }, $or: [{ status: 'REJECTED' }, { deletedAt: { $exists: true } }, { cancelled: true }] }, { projection: { _id: 1 } }).toArray()).map(photo => String(photo._id))) : new Set();
  const occupied = new Set([...(usage?.slots || []).filter(id => !released.has(String(id))), ...photos.filter(photo => ['PENDING', 'APPROVED'].includes(photo.status) && !photo.deletedAt).map(photo => photo._id)].map(String));
  await requireEnabled();
  res.status(200).json({ status: "success", results: photos.length, data: {
    photos: photos.map(photo => ({ id: photo._id, status: photo.archived ? "ARCHIVED" : photo.status, createdAt: photo.createdAt })),
    quota: { limit: 3, acceptedCount: occupied.size, remainingSlots: Math.max(0, 3 - occupied.size) },
  } });
});

exports.archiveOwn = catchAsync(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw new AppError("A valid Memory Photo ID is required.", 400);
  const photo = await MemoryPhoto.findOneAndUpdate(
    { _id: req.params.id, owner: req.userId, status: "APPROVED", archived: { $ne: true }, deletedAt: { $exists: false } },
    { $set: { archived: true, archivedAt: new Date(), archivedBy: req.userId } },
    { new: true, runValidators: true },
  ).select("_id status archived createdAt").lean();
  if (!photo) throw new AppError("Only your approved photos can be archived.", 409);
  res.status(200).json({ status: "success", data: { photo: { id: photo._id, status: "ARCHIVED", createdAt: photo.createdAt } } });
});

exports.unarchiveOwn = catchAsync(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw new AppError("A valid Memory Photo ID is required.", 400);
  const photo = await MemoryPhoto.findOneAndUpdate(
    { _id: req.params.id, owner: req.userId, status: "APPROVED", archived: true, deletedAt: { $exists: false } },
    { $set: { archived: false }, $unset: { archivedAt: 1, archivedBy: 1 } },
    { new: true, runValidators: true },
  ).select("_id status createdAt").lean();
  if (!photo) throw new AppError("Only your archived approved photos can be restored.", 409);
  res.status(200).json({ status: "success", data: { photo: { id: photo._id, status: "APPROVED", createdAt: photo.createdAt } } });
});

exports.getOwnImage = catchAsync(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw new AppError("A valid Memory Photo ID is required.", 400);
  const photo = await MemoryPhoto.findOne({ _id: req.params.id, owner: req.userId, status: "APPROVED", archived: true, deletedAt: { $exists: false } }).select("imageKey").lean();
  if (!photo) throw new AppError("Memory Photo not found.", 404);
  const image = await storage.getImage(photo.imageKey);
  if (!["image/jpeg", "image/png", "image/webp"].includes(image.contentType)) throw new AppError("Could not retrieve the Memory Photo image.", 503);
  res.set({ "Content-Type": image.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" });
  if (Buffer.isBuffer(image.body)) return res.status(200).send(image.body);
  return require("node:stream/promises").pipeline(image.body, res).catch(() => res.destroy());
});

exports.deleteOwn = catchAsync(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw new AppError("A valid Memory Photo ID is required.", 400);
  const photo = await MemoryPhoto.findOne({ _id: req.params.id, owner: req.userId, status: "APPROVED", deletedAt: { $exists: false } }).select("_id owner imageKey").lean();
  if (!photo) throw new AppError("Only your approved photos can be deleted.", 409);
  try { await storage.deleteImage(photo.imageKey); } catch (error) {
    if (!(error instanceof AppError && error.statusCode === 404)) throw new AppError("Photo deletion is pending storage confirmation. Please retry.", 503);
  }
  const marked = await MemoryPhoto.findOneAndUpdate(
    { _id: photo._id, owner: req.userId, status: "APPROVED", deletedAt: { $exists: false } },
    { $unset: { imageKey: 1 }, $set: { deletedAt: new Date(), deletedBy: req.userId, storageDeletedAt: new Date() } },
    { new: true, runValidators: false },
  ).select("_id").lean();
  if (marked) await quota.releaseSlot(req.userId, photo._id);
  res.status(200).json({ status: "success", data: { deleted: true, id: photo._id } });
});

exports.checkQuota = catchAsync(async (req, res, next) => {
  const usage = await MemoryPhotoQuota.findById(req.userId).select('slots').lean();
  if (usage?.slots?.length >= 3) {
    // Reconcile terminal records, never release unresolved reservations by age.
    await quota.recoverCancelled(req.userId); await quota.reconcileReleased(req.userId);
    const current = await MemoryPhotoQuota.findById(req.userId).select('slots').lean();
    if (current?.slots?.length >= 3) throw new AppError('You already have 3 active Memory Photos.', 409);
  }
  next();
});

exports.submitPhoto = catchAsync(async (req, res) => {
  if (req.files?.length !== 1) throw new AppError("Please upload exactly one image using the images field.", 400);
  if (Object.keys(req.body || {}).length) throw new AppError("Only an image may be submitted.", 400);
  const photoId = new mongoose.Types.ObjectId();
  let imageKey;
  try {
    await quota.reserve(req.userId, photoId);
    const file = await validateImage(req.files[0]);
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
    if (error instanceof AppError && [400, 403, 409].includes(error.statusCode)) throw error;
    throw new AppError("Could not accept the Memory Photo submission. Please retry.", 503);
  }
});
