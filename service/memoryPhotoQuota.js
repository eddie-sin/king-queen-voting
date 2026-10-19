const crypto = require("crypto");
const mongoose = require("mongoose");
const MemoryPhoto = require("../model/memoryPhotosModel");

class MemoryPhotoQuotaError extends Error {
  constructor(message = "All three Memory Photo slots are occupied.") {
    super(message);
    this.name = "MemoryPhotoQuotaError";
    this.code = "MEMORY_PHOTO_QUOTA_FULL";
  }
}

class MemoryPhotoReservationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MemoryPhotoReservationError";
    this.code = code;
  }
}

const requireObjectId = (value, name) => {
  if (!mongoose.isObjectIdOrHexString(value)) throw new TypeError(`${name} must be a valid ObjectId.`);
  return new mongoose.Types.ObjectId(value);
};

const requireDate = (value, name) => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`${name} must be a valid Date.`);
  return value;
};

const requireText = (value, name) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
  return value.trim();
};

const validateReturnedState = async (photo) => {
  if (!photo) return photo;
  MemoryPhoto.assertState(photo);
  await photo.validate();
  return photo;
};

const replacementSnapshot = {
  status: "rejected",
  storageKey: "$storageKey",
  submittedAt: "$submittedAt",
  reviewedBy: "$reviewedBy",
  reviewedAt: "$reviewedAt",
  rejectionReason: "$rejectionReason",
  originalCreatedAt: "$createdAt",
  originalUpdatedAt: "$updatedAt",
};

const claimReusableSlot = async ({ ownerId, slot, token, now, expiresAt }) => {
  const photo = await MemoryPhoto.findOneAndUpdate(
    {
      ownerId,
      slot,
      $or: [
        { status: "rejected" },
        { status: "reserved", reservationExpiresAt: { $lte: now } },
      ],
    },
    [
      {
        $set: {
          moderationHistory: {
            $cond: [
              { $eq: ["$status", "rejected"] },
              { $concatArrays: [{ $ifNull: ["$moderationHistory", []] }, [replacementSnapshot]] },
              { $ifNull: ["$moderationHistory", []] },
            ],
          },
        },
      },
      {
        $set: {
          status: "reserved",
          reservationToken: token,
          reservationExpiresAt: expiresAt,
          storageKey: null,
          submittedAt: null,
          reviewedBy: null,
          reviewedAt: null,
          rejectionReason: null,
          updatedAt: now,
        },
      },
    ],
    { new: true, timestamps: false, updatePipeline: true },
  );
  return validateReturnedState(photo);
};

const reservePhotoSlot = async ({ ownerId, now, reservationTtlMs }) => {
  const owner = requireObjectId(ownerId, "ownerId");
  requireDate(now, "now");
  if (!Number.isFinite(reservationTtlMs) || reservationTtlMs <= 0) {
    throw new TypeError("reservationTtlMs must be a positive finite number.");
  }
  const reservationToken = crypto.randomUUID();
  const reservationExpiresAt = new Date(now.getTime() + reservationTtlMs);
  MemoryPhoto.assertState({ status: "reserved", reservationToken, reservationExpiresAt });

  for (let slot = 1; slot <= 3; slot += 1) {
    const claimed = await claimReusableSlot({
      ownerId: owner, slot, token: reservationToken, now, expiresAt: reservationExpiresAt,
    });
    if (claimed) return claimed;

    try {
      const created = await MemoryPhoto.create({
        ownerId: owner,
        slot,
        status: "reserved",
        reservationToken,
        reservationExpiresAt,
        createdAt: now,
        updatedAt: now,
      });
      return validateReturnedState(created);
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  throw new MemoryPhotoQuotaError();
};

const completePhotoReservation = async ({ photoId, ownerId, reservationToken, storageKey, now }) => {
  const photo = requireObjectId(photoId, "photoId");
  const owner = requireObjectId(ownerId, "ownerId");
  const token = requireText(reservationToken, "reservationToken");
  const key = requireText(storageKey, "storageKey");
  requireDate(now, "now");
  MemoryPhoto.assertState({ status: "pending", storageKey: key, submittedAt: now });

  const completed = await MemoryPhoto.findOneAndUpdate(
    {
      _id: photo,
      ownerId: owner,
      status: "reserved",
      reservationToken: token,
      reservationExpiresAt: { $gt: now },
    },
    {
      $set: {
        status: "pending",
        storageKey: key,
        submittedAt: now,
        reservationToken: null,
        reservationExpiresAt: null,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        updatedAt: now,
      },
    },
    { new: true, runValidators: true, timestamps: false },
  );
  if (completed) return validateReturnedState(completed);

  const currentReservation = await MemoryPhoto.findOne({
    _id: photo, ownerId: owner, status: "reserved", reservationToken: token,
  }).select("reservationExpiresAt");
  if (currentReservation && currentReservation.reservationExpiresAt <= now) {
    throw new MemoryPhotoReservationError(
      "MEMORY_PHOTO_RESERVATION_EXPIRED",
      "The Memory Photo reservation has expired.",
    );
  }
  throw new MemoryPhotoReservationError(
    "MEMORY_PHOTO_RESERVATION_STALE",
    "The Memory Photo reservation is no longer current.",
  );
};

const restoreLastRejectedState = (operationTime) => [
  {
    $set: {
      status: "rejected",
      storageKey: { $arrayElemAt: ["$moderationHistory.storageKey", -1] },
      submittedAt: { $arrayElemAt: ["$moderationHistory.submittedAt", -1] },
      reviewedBy: { $arrayElemAt: ["$moderationHistory.reviewedBy", -1] },
      reviewedAt: { $arrayElemAt: ["$moderationHistory.reviewedAt", -1] },
      rejectionReason: { $arrayElemAt: ["$moderationHistory.rejectionReason", -1] },
      reservationToken: null,
      reservationExpiresAt: null,
      updatedAt: operationTime,
      moderationHistory: {
        $cond: [
          { $gt: [{ $size: "$moderationHistory" }, 1] },
          { $slice: ["$moderationHistory", 0, { $subtract: [{ $size: "$moderationHistory" }, 1] }] },
          [],
        ],
      },
    },
  },
];

const releaseCurrentReservation = async ({
  photoId, ownerId, reservationToken, operationTime, expiredBy,
}) => {
  const filter = {
    _id: photoId,
    ownerId,
    status: "reserved",
    reservationToken,
    ...(expiredBy ? { reservationExpiresAt: { $lte: expiredBy } } : {}),
  };
  const candidate = await MemoryPhoto.findOne(filter).select("moderationHistory");
  if (!candidate) return false;

  if (!candidate.moderationHistory.length) {
    return Boolean(await MemoryPhoto.findOneAndDelete(filter));
  }
  const restored = await MemoryPhoto.findOneAndUpdate(
    filter,
    restoreLastRejectedState(operationTime),
    { new: true, timestamps: false, updatePipeline: true },
  );
  if (!restored) return false;
  await validateReturnedState(restored);
  return true;
};

const releasePhotoReservation = async ({ photoId, ownerId, reservationToken }) => {
  const photo = requireObjectId(photoId, "photoId");
  const owner = requireObjectId(ownerId, "ownerId");
  const token = requireText(reservationToken, "reservationToken");
  const released = await releaseCurrentReservation({
    photoId: photo,
    ownerId: owner,
    reservationToken: token,
    operationTime: new Date(),
  });
  if (!released) {
    throw new MemoryPhotoReservationError(
      "MEMORY_PHOTO_RESERVATION_STALE",
      "The Memory Photo reservation is no longer current.",
    );
  }
  return { released: true };
};

const recoverExpiredPhotoReservations = async ({ now, ownerId } = {}) => {
  requireDate(now, "now");
  const owner = ownerId === undefined ? null : requireObjectId(ownerId, "ownerId");
  const candidates = await MemoryPhoto.find({
    status: "reserved",
    reservationExpiresAt: { $lte: now },
    ...(owner ? { ownerId: owner } : {}),
  }).select("ownerId reservationToken");
  let recovered = 0;
  for (const candidate of candidates) {
    const didRecover = await releaseCurrentReservation({
      photoId: candidate._id,
      ownerId: candidate.ownerId,
      reservationToken: candidate.reservationToken,
      operationTime: now,
      expiredBy: now,
    });
    if (didRecover) recovered += 1;
  }
  return { recovered };
};

module.exports = {
  reservePhotoSlot,
  completePhotoReservation,
  releasePhotoReservation,
  recoverExpiredPhotoReservations,
  MemoryPhotoQuotaError,
  MemoryPhotoReservationError,
};
