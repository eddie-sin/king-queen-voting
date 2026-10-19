const path = require("node:path");
const fs = require("node:fs");

const MiB = 1024 * 1024;
const number = (env, name, fallback) => {
  const value = env[name] === undefined || env[name] === "" ? fallback : Number(env[name]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
};

const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const canonical = (value) => {
  let current = path.resolve(value);
  const suffix = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    suffix.unshift(path.basename(current));
    current = parent;
  }
  const physical = fs.existsSync(current) ? fs.realpathSync.native(current) : current;
  return path.resolve(physical, ...suffix);
};

const overlaps = (left, right) => inside(left, right) || inside(right, left);

exports.loadMemoryPhotoStorageConfig = (env = process.env) => {
  const driver = env.MEMORY_PHOTO_STORAGE_DRIVER || (env.NODE_ENV === "production" ? "s3" : "local");
  if (!["local", "s3"].includes(driver)) throw new Error("MEMORY_PHOTO_STORAGE_DRIVER must be local or s3.");

  const signedUrlTtlSeconds = number(env, "MEMORY_PHOTO_SIGNED_URL_TTL_SECONDS", 300);
  if (signedUrlTtlSeconds < 60 || signedUrlTtlSeconds > 900) throw new Error("Memory Photo read TTL must be between 60 and 900 seconds.");
  const maxReservationMs = number(env, "MEMORY_PHOTO_MAX_RESERVATION_SECONDS", 1800) * 1000;
  if (maxReservationMs > 30 * 60 * 1000) throw new Error("Memory Photo reservations cannot exceed 30 minutes.");
  const clockSkewMs = number(env, "MEMORY_PHOTO_CLOCK_SKEW_SECONDS", 300) * 1000;
  const orphanGraceMs = number(env, "MEMORY_PHOTO_ORPHAN_GRACE_SECONDS", 172800) * 1000;
  if (orphanGraceMs <= maxReservationMs + clockSkewMs) throw new Error("Memory Photo orphan grace must exceed reservation duration plus clock skew.");

  const repositoryRoot = path.resolve(__dirname, "..");
  const localDirectory = canonical(env.MEMORY_PHOTO_LOCAL_STORAGE_DIR || path.join(repositoryRoot, ".memory-photo-private"));
  const publicRoots = [
    canonical(env.LOCAL_UPLOAD_DIR || path.join(repositoryRoot, "uploads")),
    canonical(path.join(repositoryRoot, "frontend", "public")),
    canonical(path.join(repositoryRoot, "admin", "public")),
  ];
  if (publicRoots.some((publicRoot) => overlaps(publicRoot, localDirectory))) {
    throw new Error("Memory Photo local storage must be outside publicly served directories.");
  }
  if (driver === "s3" && (!env.MEMORY_PHOTO_S3_BUCKET || !env.MEMORY_PHOTO_S3_REGION)) {
    throw new Error("Private Memory Photo S3 bucket and region are required.");
  }
  if (driver === "local" && (!env.MEMORY_PHOTO_LOCAL_SIGNING_SECRET || env.MEMORY_PHOTO_LOCAL_SIGNING_SECRET.length < 32)) {
    throw new Error("MEMORY_PHOTO_LOCAL_SIGNING_SECRET must contain at least 32 characters.");
  }
  if (!env.MEMORY_PHOTO_UPLOAD_FINGERPRINT_SECRET || env.MEMORY_PHOTO_UPLOAD_FINGERPRINT_SECRET.length < 32) {
    throw new Error("MEMORY_PHOTO_UPLOAD_FINGERPRINT_SECRET must contain at least 32 characters.");
  }

  return Object.freeze({
    driver,
    bucket: env.MEMORY_PHOTO_S3_BUCKET || null,
    region: env.MEMORY_PHOTO_S3_REGION || null,
    prefix: "memory-photos/v1/",
    localDirectory,
    localSigningSecret: env.MEMORY_PHOTO_LOCAL_SIGNING_SECRET || null,
    fingerprintSecret: env.MEMORY_PHOTO_UPLOAD_FINGERPRINT_SECRET,
    signedUrlTtlSeconds,
    orphanGraceMs,
    maxInputBytes: number(env, "MEMORY_PHOTO_MAX_INPUT_BYTES", 5 * MiB),
    maxOutputBytes: number(env, "MEMORY_PHOTO_MAX_OUTPUT_BYTES", 5 * MiB),
    maxPixels: number(env, "MEMORY_PHOTO_MAX_PIXELS", 16_000_000),
    maxWidth: number(env, "MEMORY_PHOTO_MAX_WIDTH", 8192),
    maxHeight: number(env, "MEMORY_PHOTO_MAX_HEIGHT", 8192),
    maxReservationMs,
    clockSkewMs,
  });
};
