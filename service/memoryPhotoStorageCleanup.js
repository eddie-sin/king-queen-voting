const DefaultStorageObject = require("../model/memoryPhotoStorageObjectsModel");
const DefaultMemoryPhoto = require("../model/memoryPhotosModel");

exports.inspectMemoryPhotoOrphans = async ({
  now, gracePeriodMs, StorageObject = DefaultStorageObject, MemoryPhoto = DefaultMemoryPhoto, storage,
}) => {
  const cutoff = new Date(now.getTime() - gracePeriodMs);
  const records = await StorageObject.find({
    $or: [
      { state: "uncertain", uncertainSince: { $lte: cutoff } },
      { state: "orphan_candidate", orphanCandidateAt: { $lte: now } },
      { state: { $in: ["allocated", "uploading", "uploaded"] }, createdAt: { $lte: cutoff } },
      { state: "compensating", compensatingAt: { $lte: cutoff } },
    ],
  });
  const candidates = [];
  const protectedRecords = [];
  if (storage.listMemoryPhotoObjects) {
    let cursor;
    do {
      const page = await storage.listMemoryPhotoObjects({ cursor });
      for (const object of page.objects || []) {
        if (object.lastModified > cutoff) continue;
        if (!await StorageObject.exists({ storageKey: object.storageKey })) {
          protectedRecords.push({ storageKey: object.storageKey, reason: "unregistered" });
        }
      }
      cursor = page.cursor;
    } while (cursor);
  }
  for (const record of records) {
    let reference;
    let active;
    try {
      reference = await MemoryPhoto.exists({ $or: [{ storageKey: record.storageKey }, { "moderationHistory.storageKey": record.storageKey }] });
      active = await MemoryPhoto.exists({ _id: record.photoId, status: "reserved", reservationExpiresAt: { $gt: now } });
    } catch { protectedRecords.push({ storageKey: record.storageKey, reason: "database_unverified" }); continue; }
    let head;
    try { head = await storage.headMemoryPhoto({ storageKey: record.storageKey }); } catch { protectedRecords.push({ storageKey: record.storageKey, reason: "storage_unverified" }); continue; }
    if (record.state === "compensating") {
      if (reference) {
        if (!head.exists || head.sha256 !== record.sha256) {
          protectedRecords.push({ storageKey: record.storageKey, reason: "storage_unverified" });
          continue;
        }
        const committed = await StorageObject.findOneAndUpdate(
          { _id: record._id, state: "compensating", compensatingAt: { $lte: cutoff } },
          { $set: { state: "committed", compensatingAt: null, uncertainSince: null } },
          { returnDocument: "after", runValidators: true },
        );
        protectedRecords.push({ storageKey: record.storageKey, reason: committed ? "referenced" : "changed_during_inspection" });
        continue;
      }
      if (active) { protectedRecords.push({ storageKey: record.storageKey, reason: "active_reservation" }); continue; }
      if (!head.exists) {
        const deleted = await StorageObject.findOneAndUpdate(
          { _id: record._id, state: "compensating", compensatingAt: { $lte: cutoff } },
          { $set: { state: "deleted", deletedAt: now, compensatingAt: null, uncertainSince: null } },
          { returnDocument: "after", runValidators: true },
        );
        protectedRecords.push({ storageKey: record.storageKey, reason: deleted ? "confirmed_deleted" : "changed_during_inspection" });
        continue;
      }
      if (head.sha256 !== record.sha256) { protectedRecords.push({ storageKey: record.storageKey, reason: "storage_unverified" }); continue; }
    }
    if (reference || active || !head.exists || head.sha256 !== record.sha256) {
      protectedRecords.push({ storageKey: record.storageKey, reason: reference ? "referenced" : active ? "active_reservation" : "storage_unverified" });
      continue;
    }
    let finalReference;
    try { finalReference = await MemoryPhoto.exists({ $or: [{ storageKey: record.storageKey }, { "moderationHistory.storageKey": record.storageKey }, { _id: record.photoId, status: "reserved", reservationExpiresAt: { $gt: now } }] }); }
    catch { protectedRecords.push({ storageKey: record.storageKey, reason: "database_unverified" }); continue; }
    if (finalReference) { protectedRecords.push({ storageKey: record.storageKey, reason: "changed_during_inspection" }); continue; }
    const transitioned = await StorageObject.findOneAndUpdate(
      {
        _id: record._id,
        state: record.state,
        ...(record.state === "allocated" || record.state === "uploading" || record.state === "uploaded"
          ? { createdAt: { $lte: cutoff } }
          : record.state === "compensating" ? { compensatingAt: { $lte: cutoff } }
            : record.state === "orphan_candidate" ? { orphanCandidateAt: { $lte: now } } : { uncertainSince: { $lte: cutoff } }),
      },
      { $set: { state: "orphan_candidate", orphanCandidateAt: now, compensatingAt: null } }, { returnDocument: "after", runValidators: true },
    );
    if (transitioned) candidates.push({ storageKey: record.storageKey, reason: "verified_unreferenced" });
  }
  return { dryRun: true, candidates, protected: protectedRecords };
};
