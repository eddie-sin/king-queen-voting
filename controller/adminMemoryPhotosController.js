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
  status: photo.deletedAt ? 'DELETED' : photo.archived ? 'ARCHIVED' : photo.status,
  createdAt: photo.createdAt,
  reviewedBy: photo.reviewedBy,
  reviewedAt: photo.reviewedAt,
});

exports.listPending = catchAsync(async (req, res) => {
  const photos = await MemoryPhoto.find({ cancelled: { $ne: true }, deletedAt: { $exists: false }, status: { $in: ['PENDING', 'APPROVED'] } })
    .select("_id owner status archived createdAt reviewedBy reviewedAt").sort({ createdAt: -1, _id: -1 }).lean();
  res.status(200).json({ status: "success", results: photos.length,
    data: { photos: photos.map(photoResponse) } });
});

exports.getImage = catchAsync(async (req, res) => {
  const photo = await MemoryPhoto.findOne({ _id: photoId(req), status: { $in: ['PENDING', 'APPROVED'] }, deletedAt: { $exists: false } }).select("imageKey").lean();
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
  const { staffMutation } = require('../utils/eventControls');
  const photo = await staffMutation(req, body.status === 'APPROVED' ? 'memory.approve' : 'memory.reject', async ({session,actor}) => { const updated = await MemoryPhoto.findOneAndUpdate({ _id: id, status: "PENDING" }, {
    $set: { status: body.status, reviewedBy: req.admin._id, reviewedAt: clock.now() },
  }, { returnDocument: "after", runValidators: true })
    .session(session).select("_id owner imageKey status createdAt reviewedBy reviewedAt").lean();
    if(updated) await require('../utils/eventControls').audit(session,actor,body.status==='APPROVED'?'memory.approve':'memory.reject',{photoId:String(updated._id)});
    return updated; });
  if (!photo) {
    if (!(await MemoryPhoto.exists({ _id: id }))) throw new AppError("Memory Photo not found.", 404);
    throw new AppError("This Memory Photo has already been reviewed.", 409);
  }
  if (body.status === 'REJECTED') {
    try { await storage.deleteImage(photo.imageKey); } catch (error) {
      if (!(error instanceof AppError && error.statusCode === 404)) {
        await MemoryPhoto.updateOne({ _id: id }, { $set: { cleanupPending: true } });
        throw new AppError("Photo rejected; private storage cleanup is pending. Please retry cleanup.", 503);
      }
    }
    await MemoryPhoto.updateOne({ _id: id, status: 'REJECTED' }, { $unset: { imageKey: 1 }, $set: { storageDeletedAt: clock.now(), cleanupPending: false } });
    const quota = require('../utils/memoryPhotoQuota');
    await quota.releaseSlot(photo.owner, id);
  }
  res.status(200).json({ status: "success", data: { photo: photoResponse(photo) } });
});

exports.deleteApproved = catchAsync(async (req, res) => {
  const id = photoId(req);
  const photo = await require('../utils/eventControls').staffMutation(req,'memory.delete',async({session,actor})=>{
    const current=await MemoryPhoto.findOne({_id:id,status:'APPROVED',deletedAt:{$exists:false}}).select('_id owner imageKey').session(session).lean();
    if(current) await require('../utils/eventControls').audit(session,actor,'memory.delete.intent',{photoId:id});
    return current;
  });
  if (!photo) throw new AppError('Only approved Memory Photos can be removed.', 409);
  try { await storage.deleteImage(photo.imageKey); } catch (error) {
    if (!(error instanceof AppError && error.statusCode === 404)) throw new AppError('Photo deletion is pending storage confirmation. Please retry.', 503);
  }
  const marked = await require('../utils/eventControls').staffMutation(req,'memory.delete',async({session,actor})=>{
    const updated = await MemoryPhoto.findOneAndUpdate(
    { _id: id, status: 'APPROVED', deletedAt: { $exists: false } },
    { $unset: { imageKey: 1 }, $set: { deletedAt: clock.now(), deletedBy: req.admin._id, storageDeletedAt: clock.now() } },
    { new: true, runValidators: false },
  ).session(session).select('_id').lean();
    if(updated)await require('../utils/eventControls').audit(session,actor,'memory.delete',{photoId:id});
    return updated;
  });
  if (marked) await require('../utils/memoryPhotoQuota').releaseSlot(photo.owner, id);
  res.status(200).json({ status: 'success', data: { deleted: true, id } });
});

exports.cleanupRejected = catchAsync(async (req, res) => {
  const id = photoId(req);
  const photo=await require('../utils/eventControls').staffMutation(req,'memory.reject',async({session,actor})=>{
    const current=await MemoryPhoto.findOne({_id:id,status:'REJECTED',cleanupPending:true}).select('+cleanupPending imageKey owner').session(session).lean();
    if(current)await require('../utils/eventControls').audit(session,actor,'memory.cleanup.intent',{photoId:id});
    return current;
  });
  if (!photo) throw new AppError('No rejected photo cleanup is pending.', 409);
  try { await storage.deleteImage(photo.imageKey); } catch (error) {
    if (!(error instanceof AppError && error.statusCode === 404)) throw new AppError('Private storage cleanup is still unavailable. Please retry.', 503);
  }
  await MemoryPhoto.updateOne({ _id: id, status: 'REJECTED', cleanupPending: true }, { $unset: { imageKey: 1 }, $set: { storageDeletedAt: clock.now(), cleanupPending: false } });
  await require('../utils/memoryPhotoQuota').releaseSlot(photo.owner, id);
  await require('../utils/eventControls').staffMutation(req,'memory.reject',async({session,actor})=>require('../utils/eventControls').audit(session,actor,'memory.cleanup',{photoId:id}));
  res.status(200).json({ status: 'success', data: { cleaned: true, id } });
});
