const MemoryPhoto = require("../model/memoryPhotosModel");
const MemoryPhotoLike = require("../model/memoryPhotoLikesModel");
const MemoryPhotoSettings = require("../model/memoryPhotoSettingsModel");

const closeField = { uploads: "uploadsCloseAt", likes: "likesCloseAt", gallery: "galleryClosesAt" };

exports.getSettings = async () => (await MemoryPhotoSettings.findById(MemoryPhotoSettings.SETTINGS_ID))
  || new MemoryPhotoSettings({ _id: MemoryPhotoSettings.SETTINGS_ID });

exports.requireOpenWindow = async (kind, now) => {
  const settings = await exports.getSettings();
  const closesAt = settings[closeField[kind]];
  if (!settings.enabled || !settings.opensAt || !closesAt || now < settings.opensAt || now >= closesAt) {
    const error = new Error(`Memory Photo ${kind} are not open.`);
    error.code = "MEMORY_PHOTO_WINDOW_CLOSED";
    throw error;
  }
  return settings;
};

exports.reviewPhoto = async ({ photoId, adminId, status, rejectionReason, now }) => {
  if (!["approved", "rejected"].includes(status)) throw Object.assign(new Error("Review status must be approved or rejected."), { code: "MEMORY_PHOTO_REVIEW_INVALID" });
  const reason = typeof rejectionReason === "string" ? rejectionReason.trim() : "";
  if (status === "rejected" && (!reason || reason.length > 500)) throw Object.assign(new Error("A rejection reason of 1 to 500 characters is required."), { code: "MEMORY_PHOTO_REJECTION_REASON_INVALID" });
  const update = {
    status, reviewedBy: adminId, reviewedAt: now, rejectionReason: status === "rejected" ? reason : null,
    reservationToken: null, reservationExpiresAt: null, updatedAt: now,
  };
  const photo = await MemoryPhoto.findOneAndUpdate({ _id: photoId, status: "pending" }, { $set: update }, { returnDocument: "after", timestamps: false });
  if (!photo) return null;
  MemoryPhoto.assertState(photo);
  await photo.validate();
  return photo;
};

exports.likePhoto = async ({ photoId, userId }) => {
  if (!await MemoryPhoto.exists({ _id: photoId, status: "approved" })) return null;
  try { await MemoryPhotoLike.create({ photoId, userId }); } catch (error) { if (error?.code !== 11000) throw error; }
  return MemoryPhotoLike.countDocuments({ photoId });
};

exports.unlikePhoto = async ({ photoId, userId }) => {
  if (!await MemoryPhoto.exists({ _id: photoId, status: "approved" })) return null;
  await MemoryPhotoLike.deleteOne({ photoId, userId });
  return MemoryPhotoLike.countDocuments({ photoId });
};

exports.approvedGallery = async ({ after, limit }) => {
  const photos = await MemoryPhoto.aggregate([
    { $match: { status: "approved", ...(after ? { _id: { $lt: after } } : {}) } },
    { $sort: { _id: -1 } },
    { $limit: limit + 1 },
    { $lookup: {
      from: MemoryPhotoLike.collection.name,
      let: { photoId: "$_id" },
      pipeline: [{ $match: { $expr: { $eq: ["$photoId", "$$photoId"] } } }, { $count: "count" }],
      as: "likeSummary",
    } },
    { $project: { _id: 1, submittedAt: 1, reviewedAt: 1, likeCount: { $ifNull: [{ $arrayElemAt: ["$likeSummary.count", 0] }, 0] } } },
  ]);
  const hasMore = photos.length > limit;
  if (hasMore) photos.pop();
  return { photos, nextCursor: hasMore ? photos.at(-1)._id.toString() : null };
};
