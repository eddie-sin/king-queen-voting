const mongoose = require("mongoose");
const MemoryPhoto = require("../model/memoryPhotosModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const clock = require("../utils/clock");
const mvp = require("../service/memoryPhotoMvp");
const { getMemoryPhotoRuntime } = require("../service/memoryPhotoRuntime");

const requireId = (value) => {
  if (!mongoose.isObjectIdOrHexString(value)) throw new AppError("Invalid Memory Photo ID.", 400);
  return value;
};
const publicPhoto = (photo) => ({
  id: photo._id.toString(), slot: photo.slot, status: photo.status,
  submittedAt: photo.submittedAt, reviewedAt: photo.reviewedAt,
  ...(photo.status === "rejected" ? { rejectionReason: photo.rejectionReason } : {}),
});
const access = async (photo) => {
  const { config, storage } = getMemoryPhotoRuntime();
  const grant = await storage.createMemoryPhotoReadGrant({ storageKey: photo.storageKey, expiresInSeconds: config.signedUrlTtlSeconds });
  return grant.kind === "url" ? grant : { ...grant, url: `/api/v1/memory-photos/files/${encodeURIComponent(grant.token)}`, token: undefined };
};
const operational = (error) => {
  if (error instanceof AppError) return error;
  if (error.code === "MEMORY_PHOTO_QUOTA_FULL") return new AppError(error.message, 409);
  if (error.code === "MEMORY_PHOTO_WINDOW_CLOSED") return new AppError(error.message, 403);
  if (error.code === "MEMORY_PHOTO_REVIEW_INVALID" || error.code === "MEMORY_PHOTO_REJECTION_REASON_INVALID") return new AppError(error.message, 400);
  if (error.code?.startsWith("MEMORY_PHOTO_IMAGE_") || error.code === "MEMORY_PHOTO_INVALID_IMAGE" || error.code === "MEMORY_PHOTO_ANIMATED_NOT_ALLOWED" || error.code === "MEMORY_PHOTO_UNSUPPORTED_HEIC") return new AppError(error.message, 400);
  if (error.code?.startsWith("MEMORY_PHOTO_STORAGE_")) return new AppError(error.message, error.code === "MEMORY_PHOTO_STORAGE_CONFLICT" ? 409 : 503);
  return error;
};

exports.getSettings = catchAsync(async (req, res) => {
  const settings = await mvp.getSettings();
  res.json({ status: "success", data: { settings } });
});

exports.updateSettings = catchAsync(async (req, res) => {
  const allowed = ["enabled", "opensAt", "uploadsCloseAt", "likesCloseAt", "galleryClosesAt"];
  if (Object.keys(req.body || {}).some((key) => !allowed.includes(key))) throw new AppError("Only Memory Photo schedule fields may be changed.", 400);
  const settings = await mvp.getSettings();
  for (const field of allowed) if (Object.hasOwn(req.body || {}, field)) settings[field] = req.body[field] === null ? null : req.body[field];
  await settings.save();
  res.json({ status: "success", data: { settings } });
});

exports.upload = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError("Upload exactly one photo using the photo field.", 400);
  try {
    await mvp.requireOpenWindow("uploads", clock.now());
    const result = await getMemoryPhotoRuntime().submission.submitReservedMemoryPhoto({ ownerId: req.userId, file: req.file, reservationTtlMs: 30 * 60 * 1000 });
    if (result.outcome === "uncertain") return res.status(202).json({ status: "accepted", data: { outcome: "uncertain", uploadId: result.uploadId } });
    return res.status(201).json({ status: "success", data: { photo: publicPhoto(result.photo) } });
  } catch (error) { throw operational(error); }
});

exports.mine = catchAsync(async (req, res) => {
  const photos = await MemoryPhoto.find({ ownerId: req.userId }).sort("slot");
  const bySlot = new Map(photos.map((photo) => [photo.slot, publicPhoto(photo)]));
  res.json({ status: "success", data: { photos: [1, 2, 3].map((slot) => bySlot.get(slot) || { slot, status: "empty" }) } });
});

exports.ownerAccess = catchAsync(async (req, res) => {
  const photo = await MemoryPhoto.findOne({ _id: requireId(req.params.id), ownerId: req.userId, storageKey: { $ne: null } });
  if (!photo) throw new AppError("Memory Photo not found.", 404);
  res.json({ status: "success", data: { access: await access(photo) } });
});

exports.pending = catchAsync(async (req, res) => {
  const photos = await MemoryPhoto.find({ status: "pending" }).sort("submittedAt").populate("ownerId", "email");
  res.json({ status: "success", results: photos.length, data: { photos: photos.map((photo) => ({ ...publicPhoto(photo), owner: { id: photo.ownerId._id, email: photo.ownerId.email } })) } });
});

exports.adminAccess = catchAsync(async (req, res) => {
  const photo = await MemoryPhoto.findOne({ _id: requireId(req.params.id), storageKey: { $ne: null } });
  if (!photo) throw new AppError("Memory Photo not found.", 404);
  res.json({ status: "success", data: { access: await access(photo) } });
});

exports.review = catchAsync(async (req, res) => {
  const photo = await mvp.reviewPhoto({ photoId: requireId(req.params.id), adminId: req.admin._id, status: req.body?.status, rejectionReason: req.body?.rejectionReason, now: clock.now() }).catch((error) => { throw operational(error); });
  if (!photo) throw new AppError("Pending Memory Photo not found.", 404);
  res.json({ status: "success", data: { photo: publicPhoto(photo) } });
});

exports.gallery = catchAsync(async (req, res) => {
  try { await mvp.requireOpenWindow("gallery", clock.now()); } catch (error) { throw operational(error); }
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new AppError("Gallery limit must be an integer from 1 to 50.", 400);
  const after = req.query.after === undefined ? null : requireId(req.query.after);
  const page = await mvp.approvedGallery({ after: after ? new mongoose.Types.ObjectId(after) : null, limit });
  const photos = page.photos.map((photo) => ({ id: photo._id.toString(), submittedAt: photo.submittedAt, reviewedAt: photo.reviewedAt, likeCount: photo.likeCount }));
  res.json({ status: "success", results: photos.length, data: { photos, nextCursor: page.nextCursor } });
});

exports.galleryAccess = catchAsync(async (req, res) => {
  try { await mvp.requireOpenWindow("gallery", clock.now()); } catch (error) { throw operational(error); }
  const photo = await MemoryPhoto.findOne({ _id: requireId(req.params.id), status: "approved" });
  if (!photo) throw new AppError("Approved Memory Photo not found.", 404);
  res.json({ status: "success", data: { access: await access(photo) } });
});

const changeLike = (remove) => catchAsync(async (req, res) => {
  try { await mvp.requireOpenWindow("likes", clock.now()); } catch (error) { throw operational(error); }
  const count = await (remove ? mvp.unlikePhoto : mvp.likePhoto)({ photoId: requireId(req.params.id), userId: req.userId });
  if (count === null) throw new AppError("Approved Memory Photo not found.", 404);
  res.json({ status: "success", data: { liked: !remove, likeCount: count } });
});
exports.like = changeLike(false);
exports.unlike = changeLike(true);

exports.localFile = catchAsync(async (req, res) => {
  const { config, storage } = getMemoryPhotoRuntime();
  if (config.driver !== "local") throw new AppError("Local Memory Photo delivery is unavailable.", 404);
  let file;
  try { file = await storage.readLocalMemoryPhoto({ token: req.params.token }); } catch { throw new AppError("Invalid or expired Memory Photo access grant.", 403); }
  res.set("Content-Type", file.contentType);
  res.set("Content-Length", String(file.contentLength));
  res.set("X-Content-Type-Options", "nosniff");
  file.stream.pipe(res);
});
