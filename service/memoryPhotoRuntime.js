const clock = require("../utils/clock");
const MemoryPhoto = require("../model/memoryPhotosModel");
const quota = require("./memoryPhotoQuota");
const { loadMemoryPhotoStorageConfig } = require("../utils/memoryPhotoStorageConfig");
const { normalizeMemoryPhoto } = require("../utils/memoryPhotoImage");
const { createMemoryPhotoLocalStorage } = require("../utils/memoryPhotoLocalStorage");
const { createMemoryPhotoS3 } = require("../utils/memoryPhotoS3");
const { createMemoryPhotoStorage } = require("../utils/memoryPhotoStorage");
const { createMemoryPhotoSubmissionService } = require("./memoryPhotoSubmission");

let runtime;

exports.getMemoryPhotoRuntime = () => {
  if (runtime) return runtime;
  const config = loadMemoryPhotoStorageConfig();
  const provider = config.driver === "s3"
    ? createMemoryPhotoS3({ bucket: config.bucket, region: config.region })
    : createMemoryPhotoLocalStorage({ directory: config.localDirectory, signingSecret: config.localSigningSecret, now: clock.now });
  const storage = createMemoryPhotoStorage({
    provider, fingerprintSecret: config.fingerprintSecret, MemoryPhotoModel: MemoryPhoto,
  });
  const submission = createMemoryPhotoSubmissionService({
    normalize: (file) => normalizeMemoryPhoto(file, config),
    reserve: quota.reservePhotoSlot,
    complete: quota.completePhotoReservation,
    release: quota.releasePhotoReservation,
    storage,
    maxReservationMs: config.maxReservationMs,
    clock: clock.now,
  });
  runtime = Object.freeze({ config, provider, storage, submission });
  return runtime;
};
