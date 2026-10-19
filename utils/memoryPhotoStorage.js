const crypto = require("node:crypto");
const mongoose = require("mongoose");
const StorageObject = require("../model/memoryPhotoStorageObjectsModel");

const asId = (value, name) => {
  if (!mongoose.isObjectIdOrHexString(value)) throw new TypeError(`${name} must be a valid ObjectId.`);
  return new mongoose.Types.ObjectId(value);
};

exports.createMemoryPhotoStorage = ({ provider, fingerprintSecret, StorageObjectModel = StorageObject, MemoryPhotoModel } = {}) => {
  const fingerprint = (token) => crypto.createHmac("sha256", fingerprintSecret).update(token).digest("hex");
  const allocateMemoryPhotoObject = async ({ ownerId, photoId, reservationToken, reservationExpiresAt, image }) => {
    const owner = asId(ownerId, "ownerId");
    const photo = asId(photoId, "photoId");
    const reservationFingerprint = fingerprint(reservationToken);
    const values = {
      storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, uploadId: crypto.randomUUID(), ownerId: owner, photoId: photo,
      reservationFingerprint, reservationExpiresAt, sha256: image.sha256, contentType: image.contentType,
      byteLength: image.byteLength, width: image.width, height: image.height, state: "allocated",
    };
    let record;
    try {
      record = await StorageObjectModel.findOneAndUpdate(
        { photoId: photo, reservationFingerprint }, { $setOnInsert: values },
        { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
      ).select("+reservationFingerprint");
    } catch (error) {
      if (error?.code !== 11000) throw error;
      record = await StorageObjectModel.findOne({ photoId: photo, reservationFingerprint }).select("+reservationFingerprint");
    }
    if (record.sha256 !== image.sha256 || record.contentType !== image.contentType || record.byteLength !== image.byteLength) {
      const error = new Error("The upload attempt cannot be reused with different content.");
      error.code = "MEMORY_PHOTO_STORAGE_CONFLICT";
      throw error;
    }
    return { storageKey: record.storageKey, uploadId: record.uploadId };
  };
  const putMemoryPhoto = async ({ storageKey, uploadId, image, now = new Date() }) => {
    const record = await StorageObjectModel.findOneAndUpdate(
      { storageKey, uploadId, sha256: image.sha256, state: { $in: ["allocated", "uncertain"] } },
      { $set: { state: "uploading", uploadingAt: now, uncertainSince: null } },
      { returnDocument: "after", runValidators: true },
    );
    if (!record) throw Object.assign(new Error("The upload allocation is no longer writable."), { code: "MEMORY_PHOTO_STORAGE_STALE" });
    let result;
    try {
      result = await provider.put({ storageKey, buffer: image.buffer, contentType: image.contentType, sha256: image.sha256 });
    } catch (error) {
      const nextState = ["MEMORY_PHOTO_STORAGE_UNCERTAIN", "MEMORY_PHOTO_STORAGE_CONFLICT"].includes(error.code) ? "uncertain" : "allocated";
      let restored = false;
      try {
        const transition = await StorageObjectModel.updateOne({ _id: record._id, state: "uploading" }, { $set: { state: nextState, uploadingAt: null, uncertainSince: nextState === "uncertain" ? now : null } });
        restored = transition.matchedCount === 1;
      } catch { /* uploading state remains recoverable */ }
      if (!restored) {
        const uncertain = new Error("The private image upload and registry outcome could not be verified.");
        uncertain.code = "MEMORY_PHOTO_STORAGE_UNCERTAIN";
        Object.defineProperty(uncertain, "cause", { value: error, enumerable: false });
        throw uncertain;
      }
      throw error;
    }
    try {
      const transitioned = await StorageObjectModel.updateOne({ _id: record._id, state: "uploading" }, { $set: { state: "uploaded", uploadingAt: null, uncertainSince: null } });
      if (transitioned.matchedCount !== 1) throw new Error("Upload registry transition was not applied.");
      return result;
    } catch (error) {
      try { await StorageObjectModel.updateOne({ _id: record._id, state: "uploading" }, { $set: { state: "uncertain", uploadingAt: null, uncertainSince: now } }); } catch { /* uploading state remains recoverable */ }
      const uncertain = new Error("The private image was stored but its registry outcome could not be verified.");
      uncertain.code = "MEMORY_PHOTO_STORAGE_UNCERTAIN";
      Object.defineProperty(uncertain, "cause", { value: error, enumerable: false });
      throw uncertain;
    }
  };
  const markCommitted = (uploadId) => StorageObjectModel.updateOne(
    { uploadId, state: { $in: ["uploaded", "uncertain", "compensating"] } },
    { $set: { state: "committed", uncertainSince: null, compensatingAt: null } },
  );
  const markUncertain = (uploadId, now) => StorageObjectModel.updateOne(
    { uploadId, state: { $nin: ["committed", "deleted"] } },
    { $set: { state: "uncertain", uncertainSince: now, compensatingAt: null } },
  );
  const markDeleted = (uploadId, now) => StorageObjectModel.updateOne(
    { uploadId, state: "compensating" },
    { $set: { state: "deleted", deletedAt: now, compensatingAt: null, uncertainSince: null } },
  );
  const headMemoryPhoto = ({ storageKey }) => provider.head({ storageKey });
  const deleteMemoryPhoto = async ({ storageKey, uploadId, ownerId, photoId, reservationToken, now = new Date() }) => {
    const record = await StorageObjectModel.findOne({ storageKey, uploadId }).select("+reservationFingerprint");
    const suppliedFingerprint = fingerprint(reservationToken);
    const fingerprintsMatch = record && crypto.timingSafeEqual(Buffer.from(record.reservationFingerprint, "hex"), Buffer.from(suppliedFingerprint, "hex"));
    if (!record || record.ownerId.toString() !== String(ownerId) || record.photoId.toString() !== String(photoId)
      || !fingerprintsMatch) throw new Error("Memory Photo deletion identity mismatch.");
    if (!MemoryPhotoModel) throw new Error("Authoritative MemoryPhoto model is required for deletion.");
    const fenced = await StorageObjectModel.findOneAndUpdate(
      { _id: record._id, state: { $in: ["allocated", "uploaded", "uncertain", "orphan_candidate"] } },
      { $set: { state: "compensating", compensatingAt: now } }, { returnDocument: "after", runValidators: true },
    );
    if (!fenced) throw new Error("Memory Photo compensation is no longer authorized.");
    const referenced = await MemoryPhotoModel.exists({ $or: [{ storageKey }, { "moderationHistory.storageKey": storageKey }] });
    const active = await MemoryPhotoModel.exists({ _id: record.photoId, status: "reserved", reservationExpiresAt: { $gt: now } });
    if (referenced || active) {
      await StorageObjectModel.updateOne({ _id: record._id, state: "compensating" }, { $set: { state: "uncertain", uncertainSince: now, compensatingAt: null } });
      throw new Error("Memory Photo object is still protected.");
    }
    let result;
    try { result = await provider.delete({ storageKey }); } catch (error) {
      await StorageObjectModel.updateOne({ _id: record._id, state: "compensating" }, { $set: { state: "uncertain", uncertainSince: now, compensatingAt: null } });
      throw error;
    }
    const finalized = await StorageObjectModel.updateOne(
      { _id: record._id, state: "compensating" },
      { $set: { state: "deleted", deletedAt: now, compensatingAt: null, uncertainSince: null } },
    );
    if (finalized.matchedCount !== 1) throw new Error("Memory Photo deletion registry outcome could not be finalized.");
    return result;
  };
  return {
    allocateMemoryPhotoObject, putMemoryPhoto, markCommitted, markUncertain, markDeleted, headMemoryPhoto, deleteMemoryPhoto,
    createMemoryPhotoReadGrant: (input) => provider.createReadGrant(input),
    readLocalMemoryPhoto: (input) => provider.readGrant(input),
    listMemoryPhotoObjects: (input) => provider.list(input),
  };
};
