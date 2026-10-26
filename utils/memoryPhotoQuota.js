const MemoryPhoto = require("../model/memoryPhotosModel");
const Quota = require("../model/memoryPhotoQuotasModel");
const AppError = require("./appError");
const mongoose = require("mongoose");
const durable = { writeConcern: { w: "majority", j: true } };

// A delete cannot fence a delayed insert. Occupy its unique _id permanently,
// whether the insert arrived before or after cancellation. Never delete fences.
exports.cancel = async (owner, photoId) => {
  const result = await MemoryPhoto.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(photoId), owner: new mongoose.Types.ObjectId(owner) },
    { $set: { cancelled: true }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true, ...durable },
  );
  if (!result.acknowledged) throw new Error("Unconfirmed Memory Photo cancellation");
};

// Retry only known cancellations, never infer failure from age or a missing photo.
// Re-fencing confirms durability even after an uncertain cancellation response.
exports.recoverCancelled = async (owner) => {
  const current = await Quota.findById(owner).lean();
  if (!current?.slots.length) return;
  const cancelled = await MemoryPhoto.collection.find({
    _id: { $in: current.slots }, owner: new mongoose.Types.ObjectId(owner), cancelled: true,
  }).toArray();
  for (const photo of cancelled) await exports.release(owner, photo._id);
};

// Reconcile quota documents created by the previous lifetime-submission rule.
// Rejected/deleted records are no longer active; pending, approved and archived
// records retain their slots. The operation is idempotent and never touches
// unresolved reservations without a corresponding terminal record.
exports.reconcileReleased = async (owner) => {
  const current = await Quota.findById(owner).select('slots').lean();
  if (!current?.slots?.length) return;
  const released = await MemoryPhoto.collection.find({ _id: { $in: current.slots }, $or: [{ status: 'REJECTED' }, { deletedAt: { $exists: true } }, { cancelled: true }] }, { projection: { _id: 1 } }).toArray();
  if (released.length) await Quota.updateOne({ _id: owner }, { $pull: { slots: { $in: released.map(photo => photo._id) } } }, durable);
};

exports.reserve = async (owner, photoId) => {
  await exports.recoverCancelled(owner);
  await exports.reconcileReleased(owner);
  if (!(await Quota.exists({ _id: owner }))) {
    // Bootstrap legacy submissions once, including every moderation status.
    // Concurrent initializers cannot overwrite the winner's reservations.
    const previous = await MemoryPhoto.find({ owner, status: { $in: ['PENDING', 'APPROVED'] }, archived: { $ne: true }, deletedAt: { $exists: false } }).select("_id").lean();
    try {
      await new Quota({ _id: owner, slots: previous.map((photo) => photo._id) }).save(durable);
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  const reserved = await Quota.findOneAndUpdate({
    _id: owner, $expr: { $lt: [{ $size: "$slots" }, 3] },
  }, { $push: { slots: photoId } }, { returnDocument: "after", ...durable });
  if (!reserved) throw new AppError("You already have 3 active Memory Photos.", 409);
};

// Token-specific and idempotent: never decrement another request's allowance.
exports.release = async (owner, photoId) => {
  await exports.cancel(owner, photoId);
  await exports.releaseSlot(owner, photoId);
};

exports.releaseSlot = async (owner, photoId) => {
  await Quota.updateOne({ _id: owner }, { $pull: { slots: photoId } }, durable);
};
