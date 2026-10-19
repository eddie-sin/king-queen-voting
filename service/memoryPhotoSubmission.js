const DefaultStorageObject = require("../model/memoryPhotoStorageObjectsModel");
const DefaultMemoryPhoto = require("../model/memoryPhotosModel");

exports.createMemoryPhotoSubmissionService = ({
  normalize, reserve, complete, release, storage,
  StorageObject = DefaultStorageObject, MemoryPhoto = DefaultMemoryPhoto, maxReservationMs = 30 * 60 * 1000,
  clock = () => new Date(),
}) => {
  if (!Number.isFinite(maxReservationMs) || maxReservationMs <= 0 || maxReservationMs > 30 * 60 * 1000) {
    throw new TypeError("Memory Photo reservation maximum must be between zero and 30 minutes.");
  }
  const authoritative = (photoId, ownerId) => MemoryPhoto.findOne({ _id: photoId, ownerId });
  const markUncertainSafely = async (uploadId, operationTime) => {
    try { await storage.markUncertain(uploadId, operationTime); } catch { /* the durable allocation remains recoverable */ }
  };
  const ensureCommitted = async (uploadId) => {
    let result;
    try { result = await storage.markCommitted(uploadId); } catch { return false; }
    if (result?.matchedCount === 1) return true;
    try { return Boolean(await StorageObject.exists({ uploadId, state: "committed" })); } catch { return false; }
  };
  const ensureDeleted = async (uploadId, operationTime) => {
    let result;
    try { result = await storage.markDeleted(uploadId, operationTime); } catch { return false; }
    if (result?.matchedCount === 1) return true;
    try { return Boolean(await StorageObject.exists({ uploadId, state: "deleted" })); } catch { return false; }
  };
  const submitReservedMemoryPhoto = async ({ ownerId, file, reservationTtlMs }) => {
    if (!Number.isFinite(reservationTtlMs) || reservationTtlMs <= 0 || reservationTtlMs > maxReservationMs) throw new TypeError("reservationTtlMs exceeds the Memory Photo submission limit.");
    const startedAt = clock();
    const reservation = await reserve({ ownerId, now: startedAt, reservationTtlMs });
    let image;
    try {
      image = await normalize(file);
    } catch (error) {
      try { await release({ photoId: reservation._id, ownerId, reservationToken: reservation.reservationToken }); } catch { /* expiration recovery remains available */ }
      throw error;
    }
    const allocation = await storage.allocateMemoryPhotoObject({ ownerId, photoId: reservation._id, reservationToken: reservation.reservationToken, reservationExpiresAt: reservation.reservationExpiresAt, image });
    const uploadTime = clock();
    if (!(reservation.reservationExpiresAt > uploadTime)) {
      try { await release({ photoId: reservation._id, ownerId, reservationToken: reservation.reservationToken }); }
      catch (error) { if (error.code !== "MEMORY_PHOTO_RESERVATION_STALE") throw error; }
      throw Object.assign(new Error("The Memory Photo reservation has expired."), { code: "MEMORY_PHOTO_RESERVATION_EXPIRED" });
    }
    try {
      await storage.putMemoryPhoto({ ...allocation, image, now: uploadTime });
    } catch (error) {
      if (error.code === "MEMORY_PHOTO_STORAGE_UNCERTAIN") return { outcome: "uncertain", uploadId: allocation.uploadId };
      if (error.code === "MEMORY_PHOTO_STORAGE_CONFLICT") throw error;
      await release({ photoId: reservation._id, ownerId, reservationToken: reservation.reservationToken });
      throw error;
    }
    try {
      const completionTime = clock();
      const photo = await complete({ photoId: reservation._id, ownerId, reservationToken: reservation.reservationToken, storageKey: allocation.storageKey, now: completionTime });
      if (!await ensureCommitted(allocation.uploadId)) return { outcome: "uncertain", uploadId: allocation.uploadId };
      return { outcome: "completed", photo };
    } catch (error) {
      let current;
      try { current = await authoritative(reservation._id, ownerId); } catch {
        await markUncertainSafely(allocation.uploadId, clock());
        return { outcome: "uncertain", uploadId: allocation.uploadId };
      }
      if (current?.status === "pending" && current.storageKey === allocation.storageKey) {
        if (!await ensureCommitted(allocation.uploadId)) return { outcome: "uncertain", uploadId: allocation.uploadId };
        return { outcome: "completed", photo: current };
      }
      if (error.code?.startsWith("MEMORY_PHOTO_RESERVATION_")) {
        try {
          await release({ photoId: reservation._id, ownerId, reservationToken: reservation.reservationToken });
        } catch (releaseError) {
          if (releaseError.code !== "MEMORY_PHOTO_RESERVATION_STALE") {
            await markUncertainSafely(allocation.uploadId, clock());
            return { outcome: "uncertain", uploadId: allocation.uploadId };
          }
          let afterFence;
          try { afterFence = await authoritative(reservation._id, ownerId); } catch {
            await markUncertainSafely(allocation.uploadId, clock());
            return { outcome: "uncertain", uploadId: allocation.uploadId };
          }
          if (afterFence?.status === "pending" && afterFence.storageKey === allocation.storageKey) {
            if (!await ensureCommitted(allocation.uploadId)) return { outcome: "uncertain", uploadId: allocation.uploadId };
            return { outcome: "completed", photo: afterFence };
          }
          await markUncertainSafely(allocation.uploadId, clock());
          return { outcome: "uncertain", uploadId: allocation.uploadId };
        }
        try {
          await storage.deleteMemoryPhoto({ ...allocation, ownerId, photoId: reservation._id, reservationToken: reservation.reservationToken, now: clock() });
        } catch (cleanupError) {
          await markUncertainSafely(allocation.uploadId, clock());
          throw cleanupError;
        }
        throw error;
      }
      await markUncertainSafely(allocation.uploadId, clock());
      return { outcome: "uncertain", uploadId: allocation.uploadId };
    }
  };
  const reconcileMemoryPhotoSubmission = async ({ uploadId, now = clock() }) => {
    const record = await StorageObject.findOne({ uploadId });
    if (!record) throw Object.assign(new Error("Unknown Memory Photo upload."), { code: "MEMORY_PHOTO_UPLOAD_NOT_FOUND" });
    let photo;
    try { photo = await MemoryPhoto.findOne({ _id: record.photoId, ownerId: record.ownerId }); } catch {
      await markUncertainSafely(uploadId, now);
      return { outcome: "uncertain", uploadId };
    }
    const referenced = photo?.storageKey === record.storageKey || photo?.moderationHistory?.some((entry) => entry.storageKey === record.storageKey);
    const active = photo?.status === "reserved" && photo.reservationExpiresAt > now;
    let stored;
    try { stored = await storage.headMemoryPhoto({ storageKey: record.storageKey }); } catch {
      await markUncertainSafely(uploadId, now);
      return { outcome: "uncertain", uploadId };
    }
    if (!stored.exists) {
      if (record.state === "compensating" && !referenced && !active && await ensureDeleted(uploadId, now)) return { outcome: "deleted", uploadId };
      await markUncertainSafely(uploadId, now);
      return { outcome: "uncertain", uploadId };
    }
    if (stored.sha256 !== record.sha256 || stored.contentType !== record.contentType || stored.contentLength !== record.byteLength) {
      await markUncertainSafely(uploadId, now);
      return { outcome: "uncertain", uploadId };
    }
    if (referenced) {
      if (!await ensureCommitted(uploadId)) return { outcome: "uncertain", uploadId };
      return { outcome: "completed", photo };
    }
    if (active) {
      await markUncertainSafely(uploadId, now);
      return { outcome: "uncertain", uploadId };
    }
    await markUncertainSafely(uploadId, now);
    return { outcome: "uncertain", uploadId };
  };
  return { submitReservedMemoryPhoto, reconcileMemoryPhotoSubmission };
};
