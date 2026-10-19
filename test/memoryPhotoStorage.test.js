const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const mongoose = require("mongoose");

const freePort = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

describe("Memory Photo storage config", () => {
  test("applies safe fixed defaults for local private storage", () => {
    const { loadMemoryPhotoStorageConfig } = require("../utils/memoryPhotoStorageConfig");
    const root = path.join(os.tmpdir(), "private-memory-photo-test");
    const config = loadMemoryPhotoStorageConfig({
      NODE_ENV: "test",
      MEMORY_PHOTO_STORAGE_DRIVER: "local",
      MEMORY_PHOTO_LOCAL_STORAGE_DIR: root,
      MEMORY_PHOTO_LOCAL_SIGNING_SECRET: "l".repeat(32),
      MEMORY_PHOTO_UPLOAD_FINGERPRINT_SECRET: "f".repeat(32),
    });
    assert.equal(config.signedUrlTtlSeconds, 300);
    assert.equal(config.orphanGraceMs, 48 * 60 * 60 * 1000);
    assert.equal(config.maxInputBytes, 5 * 1024 * 1024);
    assert.equal(config.maxOutputBytes, 5 * 1024 * 1024);
    assert.equal(config.maxPixels, 16_000_000);
    assert.equal(config.maxWidth, 8192);
    assert.equal(config.maxHeight, 8192);
    assert.equal(config.maxReservationMs, 30 * 60 * 1000);
    assert.equal(config.clockSkewMs, 5 * 60 * 1000);
    assert(Object.isFrozen(config));
  });

  test("rejects unsafe TTL, grace, roots, drivers, and incomplete S3 settings", () => {
    const { loadMemoryPhotoStorageConfig } = require("../utils/memoryPhotoStorageConfig");
    const base = {
      NODE_ENV: "test", MEMORY_PHOTO_STORAGE_DRIVER: "local",
      MEMORY_PHOTO_LOCAL_STORAGE_DIR: path.join(os.tmpdir(), "private-memory-photo-test"),
      MEMORY_PHOTO_LOCAL_SIGNING_SECRET: "l".repeat(32),
      MEMORY_PHOTO_UPLOAD_FINGERPRINT_SECRET: "f".repeat(32),
    };
    for (const value of [59, 901]) {
      assert.throws(() => loadMemoryPhotoStorageConfig({ ...base, MEMORY_PHOTO_SIGNED_URL_TTL_SECONDS: String(value) }));
    }
    assert.throws(() => loadMemoryPhotoStorageConfig({ ...base, MEMORY_PHOTO_ORPHAN_GRACE_SECONDS: "60" }));
    assert.throws(() => loadMemoryPhotoStorageConfig({ ...base, MEMORY_PHOTO_MAX_RESERVATION_SECONDS: "1801" }));
    assert.throws(() => loadMemoryPhotoStorageConfig({ ...base, MEMORY_PHOTO_LOCAL_STORAGE_DIR: path.resolve("uploads/private") }));
    assert.throws(() => loadMemoryPhotoStorageConfig({ ...base, MEMORY_PHOTO_STORAGE_DRIVER: "public" }));
    assert.throws(() => loadMemoryPhotoStorageConfig({ ...base, NODE_ENV: "production", MEMORY_PHOTO_STORAGE_DRIVER: "s3" }));
  });

  test("rejects private roots overlapping configurable and frontend public directories", async (t) => {
    const { loadMemoryPhotoStorageConfig } = require("../utils/memoryPhotoStorageConfig");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "memory-photo-config-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const publicRoot = path.join(root, "custom-public");
    await fs.mkdir(publicRoot);
    const base = {
      NODE_ENV: "test", MEMORY_PHOTO_STORAGE_DRIVER: "local", LOCAL_UPLOAD_DIR: publicRoot,
      MEMORY_PHOTO_LOCAL_SIGNING_SECRET: "l".repeat(32), MEMORY_PHOTO_UPLOAD_FINGERPRINT_SECRET: "f".repeat(32),
    };
    assert.throws(() => loadMemoryPhotoStorageConfig({ ...base, MEMORY_PHOTO_LOCAL_STORAGE_DIR: path.join(publicRoot, "private") }));
    assert.throws(() => loadMemoryPhotoStorageConfig({ ...base, MEMORY_PHOTO_LOCAL_STORAGE_DIR: path.resolve("frontend/public/private") }));

    const link = path.join(root, "linked-private");
    try {
      await fs.symlink(publicRoot, link, process.platform === "win32" ? "junction" : "dir");
      assert.throws(() => loadMemoryPhotoStorageConfig({ ...base, MEMORY_PHOTO_LOCAL_STORAGE_DIR: link }));
    } catch (error) {
      if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
    }
  });
});

describe("Memory Photo upload gate", () => {
  test("allows only one in-flight upload per authenticated account", () => {
    const { EventEmitter } = require("node:events");
    const { memoryPhotoUploadGate } = require("../middleware/memoryPhotoUpload");
    const response = new EventEmitter();
    const outcomes = [];
    memoryPhotoUploadGate({ userId: "user-1" }, response, (error) => outcomes.push(error?.statusCode || 200));
    memoryPhotoUploadGate({ userId: "user-1" }, new EventEmitter(), (error) => outcomes.push(error?.statusCode || 200));
    response.emit("finish");
    memoryPhotoUploadGate({ userId: "user-1" }, new EventEmitter(), (error) => outcomes.push(error?.statusCode || 200));
    assert.deepEqual(outcomes, [200, 429, 200]);
  });
});

describe("Memory Photo image", () => {
  test("normalizes JPEG, PNG, and WebP to metadata-free static WebP", async () => {
    const sharp = require("sharp");
    const { normalizeMemoryPhoto } = require("../utils/memoryPhotoImage");
    for (const format of ["jpeg", "png", "webp"]) {
      let pipeline = sharp({ create: { width: 8, height: 6, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 0.5 } } });
      pipeline = pipeline.withExif({ IFD0: { Copyright: "private" } })[format]();
      const input = await pipeline.toBuffer();
      const result = await normalizeMemoryPhoto({ buffer: input, mimetype: "image/jpeg", originalname: "private-name.jpg" });
      const metadata = await sharp(result.buffer).metadata();
      assert.equal(result.contentType, "image/webp");
      assert.equal(result.extension, "webp");
      assert.equal(metadata.format, "webp");
      assert.equal(metadata.pages || 1, 1);
      assert.equal(metadata.exif, undefined);
      assert.equal(result.sha256, crypto.createHash("sha256").update(result.buffer).digest("hex"));
    }
  });

  test("rejects invalid, HEIC, excessive dimensions, pixels, input, and output", async () => {
    const sharp = require("sharp");
    const { normalizeMemoryPhoto } = require("../utils/memoryPhotoImage");
    const heic = Buffer.from("000000186674797068656963", "hex");
    await assert.rejects(normalizeMemoryPhoto({ buffer: heic, mimetype: "image/heic" }), { code: "MEMORY_PHOTO_UNSUPPORTED_HEIC" });
    await assert.rejects(normalizeMemoryPhoto({ buffer: Buffer.from("<script>x</script>"), mimetype: "image/png" }), { code: "MEMORY_PHOTO_INVALID_IMAGE" });
    await assert.rejects(normalizeMemoryPhoto({ buffer: Buffer.alloc(20), mimetype: "image/png" }, { maxInputBytes: 10 }), { code: "MEMORY_PHOTO_IMAGE_TOO_LARGE" });
    const wide = await sharp({ create: { width: 100, height: 1, channels: 3, background: "red" } }).png().toBuffer();
    await assert.rejects(normalizeMemoryPhoto({ buffer: wide }, { maxWidth: 99 }), { code: "MEMORY_PHOTO_DIMENSIONS_TOO_LARGE" });
    await assert.rejects(normalizeMemoryPhoto({ buffer: wide }, { maxPixels: 99 }), { code: "MEMORY_PHOTO_DIMENSIONS_TOO_LARGE" });
    await assert.rejects(normalizeMemoryPhoto({ buffer: wide }, { maxOutputBytes: 1 }), { code: "MEMORY_PHOTO_OUTPUT_TOO_LARGE" });
  });

  test("rejects APNG and enforces limits after orientation", async () => {
    const sharp = require("sharp");
    const { normalizeMemoryPhoto } = require("../utils/memoryPhotoImage");
    const apngBase64 = await fs.readFile(path.join(__dirname, "fixtures", "two-frame.apng.base64"), "utf8");
    await assert.rejects(normalizeMemoryPhoto({ buffer: Buffer.from(apngBase64.trim(), "base64"), mimetype: "image/png" }), { code: "MEMORY_PHOTO_ANIMATED_NOT_ALLOWED" });
    const oriented = await sharp({ create: { width: 8, height: 20, channels: 3, background: "red" } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    await assert.rejects(normalizeMemoryPhoto({ buffer: oriented }, { maxWidth: 10, maxHeight: 30 }), { code: "MEMORY_PHOTO_DIMENSIONS_TOO_LARGE" });
  });
});

describe("Memory Photo local storage", () => {
  let directory;
  beforeEach(async (t) => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "memory-photo-private-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
  });
  after(async () => {});

  test("stores privately, retries matching content, and rejects mismatched overwrite", async (t) => {
    const { createMemoryPhotoLocalStorage } = require("../utils/memoryPhotoLocalStorage");
    const provider = createMemoryPhotoLocalStorage({ directory, signingSecret: "s".repeat(32) });
    const buffer = Buffer.from("private-webp");
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const key = `memory-photos/v1/${crypto.randomUUID()}.webp`;
    assert.deepEqual(await provider.put({ storageKey: key, buffer, contentType: "image/webp", sha256 }), { stored: true, matchedExisting: false });
    assert.deepEqual(await provider.put({ storageKey: key, buffer, contentType: "image/webp", sha256 }), { stored: true, matchedExisting: true });
    await assert.rejects(provider.put({ storageKey: key, buffer: Buffer.from("different"), contentType: "image/webp", sha256: "0".repeat(64) }));
    assert.equal(await fs.readFile(path.join(directory, key), "utf8"), "private-webp");
    await assert.rejects(provider.head({ storageKey: "../outside.webp" }));
  });

  test("issues expiring tamper-resistant local read grants", async (t) => {
    const { createMemoryPhotoLocalStorage } = require("../utils/memoryPhotoLocalStorage");
    const provider = createMemoryPhotoLocalStorage({ directory, signingSecret: "s".repeat(32), now: () => new Date("2026-10-20T00:00:00Z") });
    const key = `memory-photos/v1/${crypto.randomUUID()}.webp`;
    const grant = await provider.createReadGrant({ storageKey: key, expiresInSeconds: 300 });
    assert.equal(grant.kind, "local");
    assert(!grant.token.includes(key));
    const buffer = Buffer.from("private-webp");
    await provider.put({ storageKey: key, buffer, sha256: crypto.createHash("sha256").update(buffer).digest("hex") });
    const opened = await provider.readGrant({ token: grant.token });
    assert.equal(opened.contentLength, buffer.length);
    opened.stream.destroy();
    await assert.rejects(provider.readGrant({ token: `${grant.token}x` }));
  });

  test("redacts local filesystem failures", async () => {
    const { createMemoryPhotoLocalStorage } = require("../utils/memoryPhotoLocalStorage");
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "memory-photo-local-error-"));
    const blocker = path.join(parent, "blocker");
    await fs.writeFile(blocker, "not-a-directory");
    const forbidden = path.join(blocker, "child");
    const provider = createMemoryPhotoLocalStorage({ directory: forbidden, signingSecret: "s".repeat(32) });
    const key = `memory-photos/v1/${crypto.randomUUID()}.webp`;
    await assert.rejects(provider.readGrant({ token: "bad" }), (error) => !error.message.includes(forbidden));
    const buffer = Buffer.from("x");
    await assert.rejects(provider.put({ storageKey: key, buffer, sha256: crypto.createHash("sha256").update(buffer).digest("hex") }), (error) => !error.message.includes(forbidden));
    await fs.rm(parent, { recursive: true, force: true });
  });

  test("refuses symlink or junction traversal inside the private root", async (t) => {
    const { createMemoryPhotoLocalStorage } = require("../utils/memoryPhotoLocalStorage");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "memory-photo-link-root-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "memory-photo-link-outside-"));
    t.after(() => Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(outside, { recursive: true, force: true })]));
    try { await fs.symlink(outside, path.join(root, "memory-photos"), process.platform === "win32" ? "junction" : "dir"); }
    catch (error) { if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return; throw error; }
    const provider = createMemoryPhotoLocalStorage({ directory: root, signingSecret: "s".repeat(32) });
    const buffer = Buffer.from("private");
    await assert.rejects(provider.put({ storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, buffer, sha256: crypto.createHash("sha256").update(buffer).digest("hex") }), { code: "MEMORY_PHOTO_LOCAL_PATH_UNSAFE" });
  });
});

describe("Memory Photo S3", () => {
  test("uses conditional private writes and verifies matching retries", async () => {
    const { createMemoryPhotoS3 } = require("../utils/memoryPhotoS3");
    const sent = [];
    const buffer = Buffer.from("webp");
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const checksumBase64 = Buffer.from(checksum, "hex").toString("base64");
    const client = { send: async (command) => { sent.push(command); return {}; } };
    const provider = createMemoryPhotoS3({ client, bucket: "private-bucket", region: "ap-southeast-1", presign: async () => "https://signed.example/x" });
    const key = `memory-photos/v1/${crypto.randomUUID()}.webp`;
    assert.deepEqual(await provider.put({ storageKey: key, buffer, contentType: "image/webp", sha256: checksum }), { stored: true, matchedExisting: false });
    const input = sent[0].input;
    assert.equal(input.IfNoneMatch, "*");
    assert.equal(input.ServerSideEncryption, "AES256");
    assert.equal(input.ChecksumSHA256, checksumBase64);
    assert.equal(input.ACL, undefined);
    assert.equal(input.Metadata, undefined);
  });

  test("recovers a lost PutObject response only after matching HEAD and rejects mismatch", async () => {
    const { createMemoryPhotoS3 } = require("../utils/memoryPhotoS3");
    const buffer = Buffer.from("webp");
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    let mismatch = false;
    const client = { send: async (command) => {
      if (command.constructor.name === "PutObjectCommand") { const error = new Error("socket lost"); error.code = "ETIMEDOUT"; throw error; }
      return { ChecksumSHA256: Buffer.from(mismatch ? "0".repeat(64) : sha256, "hex").toString("base64"), ContentLength: buffer.length, ContentType: "image/webp" };
    } };
    const provider = createMemoryPhotoS3({ client, bucket: "private-bucket", region: "ap-southeast-1", presign: async () => "x" });
    const key = `memory-photos/v1/${crypto.randomUUID()}.webp`;
    assert.deepEqual(await provider.put({ storageKey: key, buffer, contentType: "image/webp", sha256 }), { stored: true, matchedExisting: true });
    mismatch = true;
    await assert.rejects(provider.put({ storageKey: key, buffer, contentType: "image/webp", sha256 }), { code: "MEMORY_PHOTO_STORAGE_CONFLICT" });
  });

  test("concurrent conditional writes accept the matching winner without overwriting", async () => {
    const { createMemoryPhotoS3 } = require("../utils/memoryPhotoS3");
    const buffer = Buffer.from("webp");
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    let stored = false;
    const client = { send: async (command) => {
      if (command.constructor.name === "PutObjectCommand") {
        if (!stored) { stored = true; return {}; }
        const error = new Error("precondition"); error.$metadata = { httpStatusCode: 412 }; throw error;
      }
      return { ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"), ContentLength: buffer.length, ContentType: "image/webp" };
    } };
    const provider = createMemoryPhotoS3({ client, bucket: "private-bucket", region: "ap-southeast-1", presign: async () => "x" });
    const input = { storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, buffer, contentType: "image/webp", sha256 };
    const results = await Promise.all([provider.put(input), provider.put(input)]);
    assert.equal(results.filter((result) => result.matchedExisting).length, 1);
  });

  test("rejects presigned URL lifetimes outside the configured safety range", async () => {
    const { createMemoryPhotoS3 } = require("../utils/memoryPhotoS3");
    const provider = createMemoryPhotoS3({ client: { send: async () => ({}) }, bucket: "private-bucket", region: "ap-southeast-1", presign: async () => "x" });
    const storageKey = `memory-photos/v1/${crypto.randomUUID()}.webp`;
    await assert.rejects(provider.createReadGrant({ storageKey, expiresInSeconds: 59 }));
    await assert.rejects(provider.createReadGrant({ storageKey, expiresInSeconds: 901 }));
  });

  test("keeps timed-out writes uncertain when HEAD is absent and redacts provider failures", async () => {
    const { createMemoryPhotoS3 } = require("../utils/memoryPhotoS3");
    const timeout = Object.assign(new Error("secret bucket socket failure"), { code: "ETIMEDOUT" });
    const client = { send: async (command) => {
      if (command.constructor.name === "PutObjectCommand") throw timeout;
      if (command.constructor.name === "HeadObjectCommand") throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      throw new Error("secret provider detail");
    } };
    const provider = createMemoryPhotoS3({ client, bucket: "private-secret-bucket", region: "ap-southeast-1", presign: async () => { throw new Error("secret signed url"); } });
    const buffer = Buffer.from("webp");
    const storageKey = `memory-photos/v1/${crypto.randomUUID()}.webp`;
    await assert.rejects(provider.put({ storageKey, buffer, contentType: "image/webp", sha256: crypto.createHash("sha256").update(buffer).digest("hex") }), { code: "MEMORY_PHOTO_STORAGE_UNCERTAIN" });
    for (const operation of [
      () => provider.delete({ storageKey }),
      () => provider.list(),
      () => provider.createReadGrant({ storageKey, expiresInSeconds: 300 }),
    ]) await assert.rejects(operation(), (error) => !/secret|bucket/i.test(error.message));
  });

  test("redacts failed HEAD verification", async () => {
    const { createMemoryPhotoS3 } = require("../utils/memoryPhotoS3");
    const provider = createMemoryPhotoS3({ client: { send: async () => { throw Object.assign(new Error("secret endpoint detail"), { $metadata: { httpStatusCode: 500 } }); } }, bucket: "private-secret-bucket", region: "ap-southeast-1" });
    await assert.rejects(provider.head({ storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp` }), (error) => error.code === "MEMORY_PHOTO_STORAGE_READ_FAILED" && !/secret|bucket/i.test(error.message));
  });

  test("constructs a private five-minute GET grant", async () => {
    const { createMemoryPhotoS3 } = require("../utils/memoryPhotoS3");
    let command;
    let options;
    const provider = createMemoryPhotoS3({ client: { send: async () => ({}) }, bucket: "private-bucket", region: "ap-southeast-1", now: () => new Date("2026-10-20T00:00:00Z"), presign: async (_client, value, input) => { command = value; options = input; return "https://signed.example/value"; } });
    const storageKey = `memory-photos/v1/${crypto.randomUUID()}.webp`;
    const grant = await provider.createReadGrant({ storageKey, expiresInSeconds: 300 });
    assert.equal(command.constructor.name, "GetObjectCommand");
    assert.deepEqual(command.input, { Bucket: "private-bucket", Key: storageKey, ResponseContentType: "image/webp", ResponseContentDisposition: "inline; filename=memory-photo.webp" });
    assert.deepEqual(options, { expiresIn: 300 });
    assert.equal(grant.expiresAt.toISOString(), "2026-10-20T00:05:00.000Z");
  });
});

describe("Memory Photo storage registry and submission", () => {
  let mongo;
  let mongoExit;
  let databasePath;
  let StorageObject;
  let MemoryPhoto;

  before(async () => {
    databasePath = await fs.mkdtemp(path.join(os.tmpdir(), "memory-photo-storage-db-"));
    const port = await freePort();
    mongo = spawn(process.env.MONGOD_BINARY || "mongod", ["--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", databasePath, "--logpath", path.join(databasePath, "mongod.log")], { stdio: "ignore" });
    mongoExit = new Promise((resolve) => mongo.once("exit", resolve));
    const uri = `mongodb://127.0.0.1:${port}/memory_photo_storage_test`;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { await mongoose.connect(uri, { serverSelectionTimeoutMS: 200 }); break; } catch (error) {
        if (attempt === 59) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    StorageObject = require("../model/memoryPhotoStorageObjectsModel");
    MemoryPhoto = require("../model/memoryPhotosModel");
    await Promise.all([StorageObject.syncIndexes(), MemoryPhoto.syncIndexes()]);
  }, { timeout: 30000 });

  beforeEach(async () => { await Promise.all([StorageObject.deleteMany({}), MemoryPhoto.deleteMany({})]); });
  after(async () => {
    await mongoose.disconnect();
    if (mongo?.exitCode === null) { mongo.kill("SIGTERM"); await mongoExit; }
    if (databasePath) await fs.rm(databasePath, { recursive: true, force: true });
  });

  test("Memory Photo storage registry allocates one opaque key per reservation attempt", async () => {
    const { createMemoryPhotoStorage } = require("../utils/memoryPhotoStorage");
    const provider = { put: async () => ({ stored: true }), head: async () => ({ exists: false }) };
    const storage = createMemoryPhotoStorage({ provider, fingerprintSecret: "f".repeat(32) });
    const ownerId = new mongoose.Types.ObjectId();
    const photoId = new mongoose.Types.ObjectId();
    const image = { sha256: "a".repeat(64), contentType: "image/webp", byteLength: 4, width: 2, height: 2, buffer: Buffer.from("webp") };
    const input = { ownerId, photoId, reservationToken: "secret-token", reservationExpiresAt: new Date(Date.now() + 60_000), image };
    const allocations = await Promise.all(Array.from({ length: 8 }, () => storage.allocateMemoryPhotoObject(input)));
    assert.equal(new Set(allocations.map((item) => item.storageKey)).size, 1);
    assert.match(allocations[0].storageKey, /^memory-photos\/v1\/[0-9a-f-]{36}\.webp$/);
    assert(!allocations[0].storageKey.includes(ownerId.toString()));
    const stored = await StorageObject.findOne().lean();
    assert.equal(await StorageObject.countDocuments(), 1);
    assert.equal(stored.reservationToken, undefined);
    assert(!JSON.stringify(stored).includes("secret-token"));
  });

  test("successful completion followed by lost response is recovered without deletion or release", async () => {
    const StorageObjectModel = require("../model/memoryPhotoStorageObjectsModel");
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    const ownerId = new mongoose.Types.ObjectId();
    const token = crypto.randomUUID();
    const now = new Date();
    const photo = await MemoryPhoto.create({ ownerId, slot: 1, status: "reserved", reservationToken: token, reservationExpiresAt: new Date(now.getTime() + 60000) });
    let released = 0;
    let deleted = 0;
    const image = { buffer: Buffer.from("webp"), contentType: "image/webp", extension: "webp", byteLength: 4, width: 2, height: 2, sha256: crypto.createHash("sha256").update("webp").digest("hex") };
    const storage = require("../utils/memoryPhotoStorage").createMemoryPhotoStorage({ provider: { put: async () => ({ stored: true }), head: async () => ({ exists: true, sha256: image.sha256, contentType: "image/webp", contentLength: 4 }), delete: async () => { deleted += 1; } }, fingerprintSecret: "f".repeat(32) });
    const service = createMemoryPhotoSubmissionService({
      normalize: async () => image,
      reserve: async () => photo,
      complete: async ({ storageKey }) => {
        await MemoryPhoto.updateOne({ _id: photo._id }, { $set: { status: "pending", storageKey, submittedAt: now, reservationToken: null, reservationExpiresAt: null } });
        throw Object.assign(new Error("response lost"), { code: "ETIMEDOUT" });
      },
      release: async () => { released += 1; }, storage, StorageObject: StorageObjectModel, MemoryPhoto,
      maxReservationMs: 30 * 60 * 1000,
    });
    const result = await service.submitReservedMemoryPhoto({ ownerId, file: { buffer: Buffer.from("x") }, now, reservationTtlMs: 60000 });
    assert.equal(result.outcome, "completed");
    assert.equal(released, 0);
    assert.equal(deleted, 0);
    assert.equal((await StorageObject.findOne()).state, "committed");
  });

  test("uses fresh time so an upload finishing at expiration cannot complete", async () => {
    const quota = require("../service/memoryPhotoQuota");
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    const ownerId = new mongoose.Types.ObjectId();
    const startedAt = new Date("2026-10-20T00:00:00.000Z");
    const times = [new Date("2026-10-20T00:00:00.000Z"), new Date("2026-10-20T00:00:00.500Z"), new Date("2026-10-20T00:00:01.000Z"), new Date("2026-10-20T00:00:01.001Z")];
    const image = { buffer: Buffer.from("webp"), contentType: "image/webp", extension: "webp", byteLength: 4, width: 2, height: 2, sha256: crypto.createHash("sha256").update("webp").digest("hex") };
    const storage = require("../utils/memoryPhotoStorage").createMemoryPhotoStorage({ provider: { put: async () => ({ stored: true }), delete: async () => ({ deleted: true }) }, fingerprintSecret: "f".repeat(32), MemoryPhotoModel: MemoryPhoto });
    const service = createMemoryPhotoSubmissionService({ normalize: async () => image, reserve: quota.reservePhotoSlot, complete: quota.completePhotoReservation, release: quota.releasePhotoReservation, storage, StorageObject, MemoryPhoto, clock: () => times.shift() || times.at(-1), maxReservationMs: 1800000 });
    await assert.rejects(service.submitReservedMemoryPhoto({ ownerId, file: { buffer: Buffer.from("x") }, now: startedAt, reservationTtlMs: 1000 }), { code: "MEMORY_PHOTO_RESERVATION_EXPIRED" });
    assert.equal(await MemoryPhoto.countDocuments({ ownerId, status: "pending" }), 0);
    assert.equal((await StorageObject.findOne({ ownerId })).state, "deleted");
  });

  test("ignores caller-provided future time and derives reservation expiry from the trusted clock", async () => {
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    const trusted = new Date("2026-10-20T00:00:00.000Z");
    let reservedAt;
    const expired = Object.assign(new Error("stop"), { code: "MEMORY_PHOTO_TEST_STOP" });
    const service = createMemoryPhotoSubmissionService({
      normalize: async () => ({ sha256: "a".repeat(64), contentType: "image/webp", byteLength: 4, width: 2, height: 2, buffer: Buffer.from("webp") }),
      reserve: async ({ now }) => { reservedAt = now; throw expired; }, complete: async () => {}, release: async () => {}, storage: {},
      clock: () => trusted, maxReservationMs: 1800000,
    });
    await assert.rejects(service.submitReservedMemoryPhoto({ ownerId: new mongoose.Types.ObjectId(), file: { buffer: Buffer.from("x") }, now: new Date("2099-01-01T00:00:00Z"), reservationTtlMs: 60000 }), { code: "MEMORY_PHOTO_TEST_STOP" });
    assert.equal(reservedAt.toISOString(), trusted.toISOString());
  });

  test("submission service rejects an injected reservation ceiling above thirty minutes", () => {
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    assert.throws(() => createMemoryPhotoSubmissionService({
      normalize: async () => {}, reserve: async () => {}, complete: async () => {}, release: async () => {}, storage: {},
      maxReservationMs: 30 * 60 * 1000 + 1,
    }), /30 minutes/);
  });

  test("quota rejection occurs before image normalization", async () => {
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    let normalized = 0;
    const quota = Object.assign(new Error("full"), { code: "MEMORY_PHOTO_QUOTA_FULL" });
    const service = createMemoryPhotoSubmissionService({
      normalize: async () => { normalized += 1; }, reserve: async () => { throw quota; }, complete: async () => {}, release: async () => {}, storage: {},
    });
    await assert.rejects(service.submitReservedMemoryPhoto({ ownerId: new mongoose.Types.ObjectId(), file: {}, reservationTtlMs: 60000 }), { code: "MEMORY_PHOTO_QUOTA_FULL" });
    assert.equal(normalized, 0);
  });

  test("failed normalization releases the newly acquired reservation", async () => {
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    const ownerId = new mongoose.Types.ObjectId();
    const reservation = { _id: new mongoose.Types.ObjectId(), reservationToken: crypto.randomUUID(), reservationExpiresAt: new Date(Date.now() + 60000) };
    let released = 0;
    const invalid = Object.assign(new Error("bad image"), { code: "MEMORY_PHOTO_INVALID_IMAGE" });
    const service = createMemoryPhotoSubmissionService({
      normalize: async () => { throw invalid; }, reserve: async () => reservation, complete: async () => {}, release: async (input) => { assert.equal(input.reservationToken, reservation.reservationToken); released += 1; }, storage: {},
    });
    await assert.rejects(service.submitReservedMemoryPhoto({ ownerId, file: {}, reservationTtlMs: 60000 }), { code: "MEMORY_PHOTO_INVALID_IMAGE" });
    assert.equal(released, 1);
  });

  test("completion winning the compensation fence preserves the committed object", async () => {
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    const ownerId = new mongoose.Types.ObjectId();
    const token = crypto.randomUUID();
    const now = new Date();
    const photo = await MemoryPhoto.create({ ownerId, slot: 1, status: "reserved", reservationToken: token, reservationExpiresAt: new Date(now.getTime() + 60000) });
    const image = { buffer: Buffer.from("webp"), contentType: "image/webp", extension: "webp", byteLength: 4, width: 2, height: 2, sha256: crypto.createHash("sha256").update("webp").digest("hex") };
    let storageKey;
    let deleted = 0;
    const storage = require("../utils/memoryPhotoStorage").createMemoryPhotoStorage({ provider: { put: async ({ storageKey: key }) => { storageKey = key; return { stored: true }; }, delete: async () => { deleted += 1; } }, fingerprintSecret: "f".repeat(32), MemoryPhotoModel: MemoryPhoto });
    const expired = Object.assign(new Error("expired"), { code: "MEMORY_PHOTO_RESERVATION_EXPIRED" });
    const service = createMemoryPhotoSubmissionService({
      normalize: async () => image, reserve: async () => photo, complete: async () => { throw expired; },
      release: async () => {
        await MemoryPhoto.updateOne({ _id: photo._id, status: "reserved", reservationToken: token }, { $set: { status: "pending", storageKey, submittedAt: now, reservationToken: null, reservationExpiresAt: null } });
        throw Object.assign(new Error("completion won"), { code: "MEMORY_PHOTO_RESERVATION_STALE" });
      }, storage, StorageObject, MemoryPhoto, clock: () => now, maxReservationMs: 1800000,
    });
    const result = await service.submitReservedMemoryPhoto({ ownerId, file: { buffer: Buffer.from("x") }, now, reservationTtlMs: 60000 });
    assert.equal(result.outcome, "completed");
    assert.equal(deleted, 0);
  });

  test("ambiguous storage response preserves reservation and records uncertainty", async () => {
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    const ownerId = new mongoose.Types.ObjectId();
    const token = crypto.randomUUID();
    const now = new Date();
    const photo = await MemoryPhoto.create({ ownerId, slot: 1, status: "reserved", reservationToken: token, reservationExpiresAt: new Date(now.getTime() + 60000) });
    const image = { buffer: Buffer.from("webp"), contentType: "image/webp", extension: "webp", byteLength: 4, width: 2, height: 2, sha256: crypto.createHash("sha256").update("webp").digest("hex") };
    const error = Object.assign(new Error("uncertain"), { code: "MEMORY_PHOTO_STORAGE_UNCERTAIN" });
    const storage = require("../utils/memoryPhotoStorage").createMemoryPhotoStorage({ provider: { put: async () => { throw error; }, head: async () => { throw error; } }, fingerprintSecret: "f".repeat(32) });
    let released = 0;
    const service = createMemoryPhotoSubmissionService({ normalize: async () => image, reserve: async () => photo, complete: async () => assert.fail("must not complete"), release: async () => { released += 1; }, storage, StorageObject, MemoryPhoto, maxReservationMs: 1800000 });
    const result = await service.submitReservedMemoryPhoto({ ownerId, file: { buffer: Buffer.from("x") }, now, reservationTtlMs: 60000 });
    assert.equal(result.outcome, "uncertain");
    assert.equal(released, 0);
    assert.equal((await StorageObject.findOne()).state, "uncertain");
  });

  test("confirmed expired completion compensates only after authoritative non-reference", async () => {
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    const ownerId = new mongoose.Types.ObjectId();
    const token = crypto.randomUUID();
    const now = new Date();
    const photo = await MemoryPhoto.create({ ownerId, slot: 1, status: "reserved", reservationToken: token, reservationExpiresAt: new Date(now.getTime() - 1) });
    const image = { buffer: Buffer.from("webp"), contentType: "image/webp", extension: "webp", byteLength: 4, width: 2, height: 2, sha256: crypto.createHash("sha256").update("webp").digest("hex") };
    let deleted = 0;
    let released = 0;
    const storage = require("../utils/memoryPhotoStorage").createMemoryPhotoStorage({ provider: { put: async () => ({ stored: true }), head: async () => ({ exists: true, sha256: image.sha256 }), delete: async () => { deleted += 1; return { deleted: true }; } }, fingerprintSecret: "f".repeat(32), MemoryPhotoModel: MemoryPhoto });
    const expired = Object.assign(new Error("expired"), { code: "MEMORY_PHOTO_RESERVATION_EXPIRED" });
    const service = createMemoryPhotoSubmissionService({ normalize: async () => image, reserve: async () => photo, complete: async () => { throw expired; }, release: async () => { released += 1; }, storage, StorageObject, MemoryPhoto, maxReservationMs: 1800000 });
    await assert.rejects(service.submitReservedMemoryPhoto({ ownerId, file: { buffer: Buffer.from("x") }, now, reservationTtlMs: 60000 }), { code: "MEMORY_PHOTO_RESERVATION_EXPIRED" });
    assert.equal(deleted, 0);
    assert.equal(released, 1);
  });

  test("stale release after safe compensation does not replace the confirmed completion error", async () => {
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    const ownerId = new mongoose.Types.ObjectId();
    const token = crypto.randomUUID();
    const now = new Date();
    const photo = await MemoryPhoto.create({ ownerId, slot: 1, status: "reserved", reservationToken: token, reservationExpiresAt: new Date(now.getTime() - 1) });
    const image = { buffer: Buffer.from("webp"), contentType: "image/webp", extension: "webp", byteLength: 4, width: 2, height: 2, sha256: crypto.createHash("sha256").update("webp").digest("hex") };
    const storage = require("../utils/memoryPhotoStorage").createMemoryPhotoStorage({ provider: { put: async () => ({ stored: true }), delete: async () => ({ deleted: true }) }, fingerprintSecret: "f".repeat(32), MemoryPhotoModel: MemoryPhoto });
    const expired = Object.assign(new Error("expired"), { code: "MEMORY_PHOTO_RESERVATION_EXPIRED" });
    const staleRelease = Object.assign(new Error("stale release"), { code: "MEMORY_PHOTO_RESERVATION_STALE" });
    const service = createMemoryPhotoSubmissionService({ normalize: async () => image, reserve: async () => photo, complete: async () => { throw expired; }, release: async () => { throw staleRelease; }, storage, StorageObject, MemoryPhoto, maxReservationMs: 1800000 });
    await assert.rejects(service.submitReservedMemoryPhoto({ ownerId, file: { buffer: Buffer.from("x") }, now, reservationTtlMs: 60000 }), { code: "MEMORY_PHOTO_RESERVATION_EXPIRED" });
  });

  test("verified upload conflict preserves the reservation and marks uncertainty", async () => {
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    const ownerId = new mongoose.Types.ObjectId();
    const token = crypto.randomUUID();
    const now = new Date();
    const photo = await MemoryPhoto.create({ ownerId, slot: 1, status: "reserved", reservationToken: token, reservationExpiresAt: new Date(now.getTime() + 60000) });
    const image = { buffer: Buffer.from("webp"), contentType: "image/webp", extension: "webp", byteLength: 4, width: 2, height: 2, sha256: crypto.createHash("sha256").update("webp").digest("hex") };
    const conflict = Object.assign(new Error("different object"), { code: "MEMORY_PHOTO_STORAGE_CONFLICT" });
    const storage = require("../utils/memoryPhotoStorage").createMemoryPhotoStorage({ provider: { put: async () => { throw conflict; } }, fingerprintSecret: "f".repeat(32) });
    let released = 0;
    const service = createMemoryPhotoSubmissionService({ normalize: async () => image, reserve: async () => photo, complete: async () => assert.fail(), release: async () => { released += 1; }, storage, StorageObject, MemoryPhoto, maxReservationMs: 1800000 });
    await assert.rejects(service.submitReservedMemoryPhoto({ ownerId, file: { buffer: Buffer.from("x") }, now, reservationTtlMs: 60000 }), { code: "MEMORY_PHOTO_STORAGE_CONFLICT" });
    assert.equal(released, 0);
    assert.equal((await StorageObject.findOne()).state, "uncertain");
  });

  test("successful provider write followed by registry failure remains uncertain", async () => {
    const { createMemoryPhotoStorage } = require("../utils/memoryPhotoStorage");
    const record = { _id: new mongoose.Types.ObjectId(), sha256: "a".repeat(64) };
    let writes = 0;
    const StorageObjectModel = {
      findOneAndUpdate: async () => ({ ...record, state: "uploading" }),
      updateOne: async () => { throw new Error("database response lost"); },
    };
    const storage = createMemoryPhotoStorage({ provider: { put: async () => { writes += 1; return { stored: true }; } }, fingerprintSecret: "f".repeat(32), StorageObjectModel });
    await assert.rejects(storage.putMemoryPhoto({ storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, uploadId: crypto.randomUUID(), image: { buffer: Buffer.from("x"), sha256: record.sha256, contentType: "image/webp" } }), { code: "MEMORY_PHOTO_STORAGE_UNCERTAIN" });
    assert.equal(writes, 1);
  });

  test("confirmed provider failure becomes uncertain when upload-state restoration is not verified", async () => {
    const { createMemoryPhotoStorage } = require("../utils/memoryPhotoStorage");
    const record = { _id: new mongoose.Types.ObjectId(), sha256: "a".repeat(64), state: "uploading" };
    const providerError = Object.assign(new Error("confirmed failure"), { code: "MEMORY_PHOTO_STORAGE_WRITE_FAILED" });
    const StorageObjectModel = {
      findOneAndUpdate: async () => record,
      updateOne: async () => ({ matchedCount: 0 }),
    };
    const storage = createMemoryPhotoStorage({ provider: { put: async () => { throw providerError; } }, fingerprintSecret: "f".repeat(32), StorageObjectModel });
    await assert.rejects(storage.putMemoryPhoto({ storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, uploadId: crypto.randomUUID(), image: { buffer: Buffer.from("x"), sha256: record.sha256, contentType: "image/webp" } }), { code: "MEMORY_PHOTO_STORAGE_UNCERTAIN" });
  });

  test("confirmed storage failure restores a rejected replacement", async () => {
    const quota = require("../service/memoryPhotoQuota");
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    const ownerId = new mongoose.Types.ObjectId();
    const now = new Date();
    const oldKey = `memory-photos/v1/${crypto.randomUUID()}.webp`;
    const reviewer = new mongoose.Types.ObjectId();
    await MemoryPhoto.create({ ownerId, slot: 1, status: "rejected", storageKey: oldKey, submittedAt: new Date(now - 10000), reviewedBy: reviewer, reviewedAt: new Date(now - 5000), rejectionReason: "blurred" });
    const image = { buffer: Buffer.from("webp"), contentType: "image/webp", extension: "webp", byteLength: 4, width: 2, height: 2, sha256: crypto.createHash("sha256").update("webp").digest("hex") };
    const failure = Object.assign(new Error("confirmed"), { code: "MEMORY_PHOTO_STORAGE_WRITE_FAILED" });
    const storage = require("../utils/memoryPhotoStorage").createMemoryPhotoStorage({ provider: { put: async () => { throw failure; } }, fingerprintSecret: "f".repeat(32), MemoryPhotoModel: MemoryPhoto });
    const service = createMemoryPhotoSubmissionService({ normalize: async () => image, reserve: quota.reservePhotoSlot, complete: quota.completePhotoReservation, release: quota.releasePhotoReservation, storage, StorageObject, MemoryPhoto, clock: () => now, maxReservationMs: 1800000 });
    await assert.rejects(service.submitReservedMemoryPhoto({ ownerId, file: { buffer: Buffer.from("x") }, now, reservationTtlMs: 60000 }), { code: "MEMORY_PHOTO_STORAGE_WRITE_FAILED" });
    const restored = await MemoryPhoto.findOne({ ownerId });
    assert.equal(restored.status, "rejected");
    assert.equal(restored.storageKey, oldKey);
    assert.equal(restored.rejectionReason, "blurred");
  });

  test("compensated deletion refuses current and moderation-history references", async () => {
    const { createMemoryPhotoStorage } = require("../utils/memoryPhotoStorage");
    const ownerId = new mongoose.Types.ObjectId();
    const photoId = new mongoose.Types.ObjectId();
    const token = "token";
    const image = { buffer: Buffer.from("webp"), contentType: "image/webp", byteLength: 4, width: 2, height: 2, sha256: crypto.createHash("sha256").update("webp").digest("hex") };
    let deleted = 0;
    const storage = createMemoryPhotoStorage({ provider: { delete: async () => { deleted += 1; } }, fingerprintSecret: "f".repeat(32), MemoryPhotoModel: MemoryPhoto });
    const allocation = await storage.allocateMemoryPhotoObject({ ownerId, photoId, reservationToken: token, reservationExpiresAt: new Date(Date.now() - 1000), image });
    await MemoryPhoto.create({ _id: photoId, ownerId, slot: 1, status: "pending", storageKey: allocation.storageKey, submittedAt: new Date() });
    await assert.rejects(storage.deleteMemoryPhoto({ ...allocation, ownerId, photoId, reservationToken: token }));
    await MemoryPhoto.updateOne({ _id: photoId }, { $set: { storageKey: "memory-photos/v1/11111111-1111-4111-8111-111111111111.webp", status: "rejected", reviewedBy: new mongoose.Types.ObjectId(), reviewedAt: new Date(), rejectionReason: "x", moderationHistory: [{ status: "rejected", storageKey: allocation.storageKey, submittedAt: new Date(), reviewedBy: new mongoose.Types.ObjectId(), reviewedAt: new Date(), rejectionReason: "old", originalCreatedAt: new Date(), originalUpdatedAt: new Date() }] } });
    await assert.rejects(storage.deleteMemoryPhoto({ ...allocation, ownerId, photoId, reservationToken: token }));
    assert.equal(deleted, 0);
  });

  test("failed provider deletion restores compensating state to uncertain", async () => {
    const { createMemoryPhotoStorage } = require("../utils/memoryPhotoStorage");
    const ownerId = new mongoose.Types.ObjectId();
    const photoId = new mongoose.Types.ObjectId();
    const token = "delete-failure-token";
    const now = new Date();
    const image = { buffer: Buffer.from("webp"), contentType: "image/webp", byteLength: 4, width: 2, height: 2, sha256: crypto.createHash("sha256").update("webp").digest("hex") };
    const storage = createMemoryPhotoStorage({ provider: { delete: async () => { throw Object.assign(new Error("delete failed"), { code: "MEMORY_PHOTO_STORAGE_DELETE_FAILED" }); } }, fingerprintSecret: "f".repeat(32), MemoryPhotoModel: MemoryPhoto });
    const allocation = await storage.allocateMemoryPhotoObject({ ownerId, photoId, reservationToken: token, reservationExpiresAt: new Date(now - 1000), image });
    await assert.rejects(storage.deleteMemoryPhoto({ ...allocation, ownerId, photoId, reservationToken: token, now }), { code: "MEMORY_PHOTO_STORAGE_DELETE_FAILED" });
    const record = await StorageObject.findOne({ uploadId: allocation.uploadId });
    assert.equal(record.state, "uncertain");
    assert(record.uncertainSince);
    assert.equal(record.compensatingAt, null);
  });

  test("successful provider deletion records a durable deleted terminal state", async () => {
    const { createMemoryPhotoStorage } = require("../utils/memoryPhotoStorage");
    const ownerId = new mongoose.Types.ObjectId();
    const photoId = new mongoose.Types.ObjectId();
    const token = "deleted-terminal-token";
    const now = new Date();
    const image = { buffer: Buffer.from("webp"), contentType: "image/webp", byteLength: 4, width: 2, height: 2, sha256: crypto.createHash("sha256").update("webp").digest("hex") };
    const storage = createMemoryPhotoStorage({ provider: { delete: async () => ({ deleted: true }) }, fingerprintSecret: "f".repeat(32), MemoryPhotoModel: MemoryPhoto });
    const allocation = await storage.allocateMemoryPhotoObject({ ownerId, photoId, reservationToken: token, reservationExpiresAt: new Date(now - 1000), image });
    await storage.deleteMemoryPhoto({ ...allocation, ownerId, photoId, reservationToken: token, now });
    const record = await StorageObject.findOne({ uploadId: allocation.uploadId });
    assert.equal(record.state, "deleted");
    assert(record.deletedAt);
  });

  test("terminal deleted allocations reject stale upload retries before provider storage", async () => {
    const { createMemoryPhotoStorage } = require("../utils/memoryPhotoStorage");
    const ownerId = new mongoose.Types.ObjectId();
    const photoId = new mongoose.Types.ObjectId();
    const token = "terminal-upload-token";
    const now = new Date();
    const image = { buffer: Buffer.from("webp"), contentType: "image/webp", byteLength: 4, width: 2, height: 2, sha256: crypto.createHash("sha256").update("webp").digest("hex") };
    let puts = 0;
    const storage = createMemoryPhotoStorage({ provider: { put: async () => { puts += 1; return { stored: true }; }, delete: async () => ({ deleted: true }) }, fingerprintSecret: "f".repeat(32), MemoryPhotoModel: MemoryPhoto });
    const allocation = await storage.allocateMemoryPhotoObject({ ownerId, photoId, reservationToken: token, reservationExpiresAt: new Date(now - 1000), image });
    await storage.deleteMemoryPhoto({ ...allocation, ownerId, photoId, reservationToken: token, now });

    await assert.rejects(storage.putMemoryPhoto({ ...allocation, image, now }), { code: "MEMORY_PHOTO_STORAGE_STALE" });
    assert.equal(puts, 0);
    assert.equal((await StorageObject.findOne({ uploadId: allocation.uploadId })).state, "deleted");
  });

  test("registry cleanup failure after provider deletion remains recoverable as compensating", async () => {
    const { createMemoryPhotoStorage } = require("../utils/memoryPhotoStorage");
    const ownerId = new mongoose.Types.ObjectId();
    const photoId = new mongoose.Types.ObjectId();
    const token = "registry-failure-token";
    const fingerprint = crypto.createHmac("sha256", "f".repeat(32)).update(token).digest("hex");
    const record = { _id: new mongoose.Types.ObjectId(), storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, uploadId: crypto.randomUUID(), ownerId, photoId, reservationFingerprint: fingerprint, state: "allocated", select() { return this; } };
    const model = {
      findOne: () => record,
      findOneAndUpdate: async () => ({ ...record, state: "compensating" }),
      updateOne: async () => { throw new Error("registry unavailable"); },
      deleteOne: async () => { throw new Error("registry unavailable"); },
    };
    const storage = createMemoryPhotoStorage({ provider: { delete: async () => ({ deleted: true }) }, fingerprintSecret: "f".repeat(32), StorageObjectModel: model, MemoryPhotoModel: { exists: async () => false } });
    await assert.rejects(storage.deleteMemoryPhoto({ storageKey: record.storageKey, uploadId: record.uploadId, ownerId, photoId, reservationToken: token, now: new Date() }), /registry unavailable/);
  });

  test("failed compensating-to-uncertain persistence fails closed after provider deletion failure", async () => {
    const { createMemoryPhotoStorage } = require("../utils/memoryPhotoStorage");
    const ownerId = new mongoose.Types.ObjectId();
    const photoId = new mongoose.Types.ObjectId();
    const token = "restore-failure-token";
    const fingerprint = crypto.createHmac("sha256", "f".repeat(32)).update(token).digest("hex");
    const record = { _id: new mongoose.Types.ObjectId(), storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, uploadId: crypto.randomUUID(), ownerId, photoId, reservationFingerprint: fingerprint, select() { return this; } };
    let deleteCalls = 0;
    const storage = createMemoryPhotoStorage({
      provider: { delete: async () => { deleteCalls += 1; throw new Error("provider failed"); } }, fingerprintSecret: "f".repeat(32),
      StorageObjectModel: { findOne: () => record, findOneAndUpdate: async () => ({ ...record, state: "compensating" }), updateOne: async () => { throw new Error("registry unavailable"); } },
      MemoryPhotoModel: { exists: async () => false },
    });
    await assert.rejects(storage.deleteMemoryPhoto({ storageKey: record.storageKey, uploadId: record.uploadId, ownerId, photoId, reservationToken: token, now: new Date() }), /registry unavailable/);
    assert.equal(deleteCalls, 1);
  });

  test("authoritative database failure after compensation fencing never calls provider deletion", async () => {
    const { createMemoryPhotoStorage } = require("../utils/memoryPhotoStorage");
    const ownerId = new mongoose.Types.ObjectId();
    const photoId = new mongoose.Types.ObjectId();
    const token = "authoritative-failure-token";
    const now = new Date();
    const image = { buffer: Buffer.from("webp"), contentType: "image/webp", byteLength: 4, width: 2, height: 2, sha256: crypto.createHash("sha256").update("webp").digest("hex") };
    let deleted = 0;
    const storage = createMemoryPhotoStorage({ provider: { delete: async () => { deleted += 1; } }, fingerprintSecret: "f".repeat(32), StorageObjectModel: StorageObject, MemoryPhotoModel: { exists: async () => { throw new Error("database unavailable"); } } });
    const allocation = await storage.allocateMemoryPhotoObject({ ownerId, photoId, reservationToken: token, reservationExpiresAt: new Date(now - 1000), image });
    await assert.rejects(storage.deleteMemoryPhoto({ ...allocation, ownerId, photoId, reservationToken: token, now }), /database unavailable/);
    assert.equal(deleted, 0);
    assert.equal((await StorageObject.findOne({ uploadId: allocation.uploadId })).state, "compensating");
  });

  test("actual Phase 1 completion and compensation fence have exactly one winner", async () => {
    const quota = require("../service/memoryPhotoQuota");
    const ownerId = new mongoose.Types.ObjectId();
    const now = new Date();
    const reserved = await quota.reservePhotoSlot({ ownerId, now, reservationTtlMs: 60000 });
    const key = `memory-photos/v1/${crypto.randomUUID()}.webp`;
    const [completion, release] = await Promise.allSettled([
      quota.completePhotoReservation({ photoId: reserved._id, ownerId, reservationToken: reserved.reservationToken, storageKey: key, now: new Date(now.getTime() + 1) }),
      quota.releasePhotoReservation({ photoId: reserved._id, ownerId, reservationToken: reserved.reservationToken }),
    ]);
    assert.equal([completion, release].filter((result) => result.status === "fulfilled").length, 1);
    const final = await MemoryPhoto.findById(reserved._id);
    assert(final === null || (final.status === "pending" && final.storageKey === key));
  });

  test("dry-run orphan inspection protects uncertainty then explicitly marks verified old orphan candidates", async () => {
    const { inspectMemoryPhotoOrphans } = require("../service/memoryPhotoStorageCleanup");
    const now = new Date("2026-10-20T12:00:00Z");
    const record = await StorageObject.create({
      storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, uploadId: crypto.randomUUID(),
      ownerId: new mongoose.Types.ObjectId(), photoId: new mongoose.Types.ObjectId(), reservationFingerprint: "a".repeat(64),
      reservationExpiresAt: new Date("2026-10-17T00:00:00Z"), sha256: "b".repeat(64), contentType: "image/webp",
      byteLength: 4, width: 2, height: 2, state: "uncertain", uncertainSince: new Date("2026-10-17T00:00:00Z"),
      createdAt: new Date("2026-10-17T00:00:00Z"), updatedAt: new Date("2026-10-17T00:00:00Z"),
    });
    let deleted = 0;
    const report = await inspectMemoryPhotoOrphans({ now, gracePeriodMs: 48 * 60 * 60 * 1000, StorageObject, MemoryPhoto, storage: { headMemoryPhoto: async () => ({ exists: true, sha256: record.sha256 }), deleteMemoryPhoto: async () => { deleted += 1; } } });
    assert.equal(report.dryRun, true);
    assert.equal(report.candidates.length, 1);
    assert.equal((await StorageObject.findById(record._id)).state, "orphan_candidate");
    assert.equal(deleted, 0);
  });

  test("dry-run orphan inspection protects active reservations and grace-period records", async () => {
    const { inspectMemoryPhotoOrphans } = require("../service/memoryPhotoStorageCleanup");
    const now = new Date("2026-10-20T12:00:00Z");
    const ownerId = new mongoose.Types.ObjectId();
    const photo = await MemoryPhoto.create({ ownerId, slot: 1, status: "reserved", reservationToken: crypto.randomUUID(), reservationExpiresAt: new Date("2026-10-20T13:00:00Z") });
    const common = { ownerId, photoId: photo._id, reservationFingerprint: "c".repeat(64), sha256: "d".repeat(64), contentType: "image/webp", byteLength: 4, width: 2, height: 2, state: "uncertain" };
    await StorageObject.create({ ...common, storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, uploadId: crypto.randomUUID(), reservationExpiresAt: new Date("2026-10-20T13:00:00Z"), uncertainSince: new Date("2026-10-17T00:00:00Z") });
    await StorageObject.create({ ...common, photoId: new mongoose.Types.ObjectId(), storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, uploadId: crypto.randomUUID(), reservationExpiresAt: new Date("2026-10-20T11:00:00Z"), uncertainSince: new Date("2026-10-20T11:30:00Z") });
    const report = await inspectMemoryPhotoOrphans({ now, gracePeriodMs: 48 * 60 * 60 * 1000, StorageObject, MemoryPhoto, storage: { headMemoryPhoto: async () => ({ exists: true, sha256: "d".repeat(64) }) } });
    assert.equal(report.candidates.length, 0);
    assert.equal(await StorageObject.countDocuments({ state: "uncertain" }), 2);
  });

  test("dry-run orphan inspection reports old unregistered storage objects as protected", async () => {
    const { inspectMemoryPhotoOrphans } = require("../service/memoryPhotoStorageCleanup");
    const now = new Date("2026-10-20T12:00:00Z");
    const storageKey = `memory-photos/v1/${crypto.randomUUID()}.webp`;
    const report = await inspectMemoryPhotoOrphans({
      now, gracePeriodMs: 48 * 60 * 60 * 1000, StorageObject, MemoryPhoto,
      storage: { listMemoryPhotoObjects: async () => ({ objects: [{ storageKey, lastModified: new Date("2026-10-17T00:00:00Z"), size: 4 }] }), headMemoryPhoto: async () => ({ exists: true, sha256: "e".repeat(64) }) },
    });
    assert.equal(report.candidates.length, 0);
    assert.deepEqual(report.protected, [{ storageKey, reason: "unregistered" }]);
  });

  test("dry-run inspection accounts for aged allocated and uploaded crash remnants", async () => {
    const { inspectMemoryPhotoOrphans } = require("../service/memoryPhotoStorageCleanup");
    const now = new Date("2026-10-20T12:00:00Z");
    const old = new Date("2026-10-17T00:00:00Z");
    for (const state of ["allocated", "uploaded"]) await StorageObject.create({
      storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, uploadId: crypto.randomUUID(), ownerId: new mongoose.Types.ObjectId(), photoId: new mongoose.Types.ObjectId(),
      reservationFingerprint: crypto.randomBytes(32).toString("hex"), reservationExpiresAt: old, sha256: "a".repeat(64), contentType: "image/webp", byteLength: 4, width: 2, height: 2,
      state, createdAt: old, updatedAt: old,
    });
    const report = await inspectMemoryPhotoOrphans({ now, gracePeriodMs: 48 * 60 * 60 * 1000, StorageObject, MemoryPhoto, storage: { headMemoryPhoto: async () => ({ exists: true, sha256: "a".repeat(64) }) } });
    assert.equal(report.candidates.length, 2);
  });

  test("aged compensating records are reconciled by dry-run inspection", async () => {
    const { inspectMemoryPhotoOrphans } = require("../service/memoryPhotoStorageCleanup");
    const now = new Date("2026-10-20T12:00:00Z");
    const old = new Date("2026-10-17T00:00:00Z");
    const common = { uploadId: crypto.randomUUID(), ownerId: new mongoose.Types.ObjectId(), photoId: new mongoose.Types.ObjectId(), reservationFingerprint: "a".repeat(64), reservationExpiresAt: old, sha256: "b".repeat(64), contentType: "image/webp", byteLength: 4, width: 2, height: 2, state: "compensating", compensatingAt: old };
    const existing = await StorageObject.create({ ...common, storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp` });
    const absent = await StorageObject.create({ ...common, uploadId: crypto.randomUUID(), photoId: new mongoose.Types.ObjectId(), storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp` });
    const report = await inspectMemoryPhotoOrphans({ now, gracePeriodMs: 48 * 60 * 60 * 1000, StorageObject, MemoryPhoto, storage: { headMemoryPhoto: async ({ storageKey }) => ({ exists: storageKey === existing.storageKey, sha256: existing.sha256 }) } });
    assert(report.candidates.some((item) => item.storageKey === existing.storageKey));
    assert.equal((await StorageObject.findById(existing._id)).state, "orphan_candidate");
    assert.equal((await StorageObject.findById(absent._id)).state, "deleted");
  });

  test("orphan candidates remain visible in repeated dry-run inspections", async () => {
    const { inspectMemoryPhotoOrphans } = require("../service/memoryPhotoStorageCleanup");
    const now = new Date("2026-10-20T12:00:00Z");
    const old = new Date("2026-10-17T00:00:00Z");
    const record = await StorageObject.create({ storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, uploadId: crypto.randomUUID(), ownerId: new mongoose.Types.ObjectId(), photoId: new mongoose.Types.ObjectId(), reservationFingerprint: "a".repeat(64), reservationExpiresAt: old, sha256: "b".repeat(64), contentType: "image/webp", byteLength: 4, width: 2, height: 2, state: "uploaded", createdAt: old, updatedAt: old });
    const storage = { headMemoryPhoto: async () => ({ exists: true, sha256: record.sha256 }) };

    const first = await inspectMemoryPhotoOrphans({ now, gracePeriodMs: 48 * 60 * 60 * 1000, StorageObject, MemoryPhoto, storage });
    const second = await inspectMemoryPhotoOrphans({ now: new Date(now.getTime() + 1000), gracePeriodMs: 48 * 60 * 60 * 1000, StorageObject, MemoryPhoto, storage });

    assert.deepEqual(first.candidates.map(({ storageKey }) => storageKey), [record.storageKey]);
    assert.deepEqual(second.candidates.map(({ storageKey }) => storageKey), [record.storageKey]);
  });

  test("dry-run inspection follows pagination and fails closed on a final database read error", async () => {
    const { inspectMemoryPhotoOrphans } = require("../service/memoryPhotoStorageCleanup");
    const now = new Date("2026-10-20T12:00:00Z");
    const old = new Date("2026-10-17T00:00:00Z");
    const record = await StorageObject.create({ storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, uploadId: crypto.randomUUID(), ownerId: new mongoose.Types.ObjectId(), photoId: new mongoose.Types.ObjectId(), reservationFingerprint: "a".repeat(64), reservationExpiresAt: old, sha256: "b".repeat(64), contentType: "image/webp", byteLength: 4, width: 2, height: 2, state: "uncertain", uncertainSince: old });
    let pages = 0;
    let reads = 0;
    const MemoryPhotoFailingFinalRead = { exists: async () => { reads += 1; if (reads === 3) throw new Error("database unavailable"); return false; } };
    const report = await inspectMemoryPhotoOrphans({ now, gracePeriodMs: 48 * 60 * 60 * 1000, StorageObject, MemoryPhoto: MemoryPhotoFailingFinalRead, storage: {
      listMemoryPhotoObjects: async ({ cursor }) => { pages += 1; return cursor ? { objects: [] } : { objects: [], cursor: "next" }; },
      headMemoryPhoto: async () => ({ exists: true, sha256: record.sha256 }),
    } });
    assert.equal(pages, 2);
    assert.equal(report.candidates.length, 0);
    assert.deepEqual(report.protected, [{ storageKey: record.storageKey, reason: "database_unverified" }]);
    assert.equal((await StorageObject.findById(record._id)).state, "uncertain");
  });

  test("reconciliation confirms authoritative pending state and preserves active reservations", async () => {
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    const ownerId = new mongoose.Types.ObjectId();
    const now = new Date();
    const pending = await MemoryPhoto.create({ ownerId, slot: 1, status: "pending", storageKey: `memory-photos/v1/${crypto.randomUUID()}.webp`, submittedAt: now });
    const record = await StorageObject.create({ storageKey: pending.storageKey, uploadId: crypto.randomUUID(), ownerId, photoId: pending._id, reservationFingerprint: "a".repeat(64), reservationExpiresAt: new Date(now.getTime() - 1000), sha256: "b".repeat(64), contentType: "image/webp", byteLength: 4, width: 2, height: 2, state: "uncertain", uncertainSince: now });
    const storage = require("../utils/memoryPhotoStorage").createMemoryPhotoStorage({ provider: { head: async () => ({ exists: true, sha256: record.sha256, contentType: "image/webp", contentLength: 4 }) }, fingerprintSecret: "f".repeat(32), StorageObjectModel: StorageObject });
    const service = createMemoryPhotoSubmissionService({ normalize: async () => {}, reserve: async () => {}, complete: async () => {}, release: async () => {}, storage, StorageObject, MemoryPhoto, clock: () => now });
    const result = await service.reconcileMemoryPhotoSubmission({ uploadId: record.uploadId, now });
    assert.equal(result.outcome, "completed");
    assert.equal((await StorageObject.findById(record._id)).state, "committed");
  });

  test("reconciliation restores referenced compensating records to committed and verifies the transition", async () => {
    const { createMemoryPhotoSubmissionService } = require("../service/memoryPhotoSubmission");
    const ownerId = new mongoose.Types.ObjectId();
    const now = new Date();
    const key = `memory-photos/v1/${crypto.randomUUID()}.webp`;
    const photo = await MemoryPhoto.create({ ownerId, slot: 1, status: "pending", storageKey: key, submittedAt: now });
    const record = await StorageObject.create({ storageKey: key, uploadId: crypto.randomUUID(), ownerId, photoId: photo._id, reservationFingerprint: "a".repeat(64), reservationExpiresAt: new Date(now - 1000), sha256: "b".repeat(64), contentType: "image/webp", byteLength: 4, width: 2, height: 2, state: "compensating", compensatingAt: now });
    const storage = require("../utils/memoryPhotoStorage").createMemoryPhotoStorage({ provider: { head: async () => ({ exists: true, sha256: record.sha256, contentType: record.contentType, contentLength: record.byteLength }) }, fingerprintSecret: "f".repeat(32), StorageObjectModel: StorageObject });
    const service = createMemoryPhotoSubmissionService({ normalize: async () => {}, reserve: async () => {}, complete: async () => {}, release: async () => {}, storage, StorageObject, MemoryPhoto, clock: () => now });
    assert.equal((await service.reconcileMemoryPhotoSubmission({ uploadId: record.uploadId, now })).outcome, "completed");
    assert.equal((await StorageObject.findById(record._id)).state, "committed");

    await StorageObject.updateOne({ _id: record._id }, { $set: { state: "compensating", compensatingAt: now } });
    const brokenStorage = { ...storage, markCommitted: async () => ({ matchedCount: 0 }) };
    const broken = createMemoryPhotoSubmissionService({ normalize: async () => {}, reserve: async () => {}, complete: async () => {}, release: async () => {}, storage: brokenStorage, StorageObject, MemoryPhoto, clock: () => now });
    assert.equal((await broken.reconcileMemoryPhotoSubmission({ uploadId: record.uploadId, now })).outcome, "uncertain");
  });
});
