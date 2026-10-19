const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const mongoose = require("mongoose");

const MemoryPhoto = require("../model/memoryPhotosModel");
const MemoryPhotoLike = require("../model/memoryPhotoLikesModel");
const MemoryPhotoSettings = require("../model/memoryPhotoSettingsModel");
const {
  reservePhotoSlot,
  completePhotoReservation,
  releasePhotoReservation,
  recoverExpiredPhotoReservations,
  MemoryPhotoQuotaError,
} = require("../service/memoryPhotoQuota");

const configuredMongod = process.env.MONGOD_BINARY;
const pathMongod = spawnSync("where.exe", ["mongod"], { encoding: "utf8" });
const mongodBinary = configuredMongod || (pathMongod.status === 0 ? pathMongod.stdout.trim().split(/\r?\n/)[0] : null);
const dbTest = mongodBinary ? test : test.skip;

let mongo;
let mongoExit;
let databasePath;

const freePort = () => new Promise((resolve, reject) => {
  const listener = net.createServer();
  listener.on("error", reject);
  listener.listen(0, "127.0.0.1", () => {
    const { port } = listener.address();
    listener.close(() => resolve(port));
  });
});

before(async () => {
  if (!mongodBinary) return;
  databasePath = await fs.mkdtemp(path.join(os.tmpdir(), "memory-photo-test-"));
  const port = await freePort();
  mongo = spawn(mongodBinary, [
    "--bind_ip", "127.0.0.1", "--port", String(port),
    "--dbpath", databasePath, "--logpath", path.join(databasePath, "mongod.log"),
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let spawnError;
  mongo.on("error", (error) => { spawnError = error; });
  mongoExit = new Promise((resolve) => mongo.once("exit", resolve));
  const uri = `mongodb://127.0.0.1:${port}`;
  const client = new mongoose.mongo.MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 300 });
  for (let attempt = 0; ; attempt += 1) {
    try {
      await client.connect();
      break;
    } catch (error) {
      if (spawnError || mongo.exitCode !== null || attempt >= 50) {
        throw new Error(`Cannot start temporary mongod: ${spawnError?.message || error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const hello = await client.db("admin").command({ hello: 1 });
  assert.equal(hello.setName, undefined, "Memory Photo tests must use standalone MongoDB");
  await client.close();
  await mongoose.connect(`${uri}/memory_photo_test`);
  await Promise.all([MemoryPhoto.init(), MemoryPhotoLike.init()]);
});

beforeEach(async () => {
  if (!mongodBinary) return;
  await Promise.all([MemoryPhoto.deleteMany({}), MemoryPhotoLike.deleteMany({})]);
});

after(async () => {
  if (!mongodBinary) return;
  await mongoose.disconnect();
  if (mongo && mongo.exitCode === null) {
    mongo.kill("SIGTERM");
    await mongoExit;
  }
  if (databasePath) await fs.rm(databasePath, { recursive: true, force: true });
});

const ownerId = () => new mongoose.Types.ObjectId();
const reviewerId = () => new mongoose.Types.ObjectId();
const at = (iso) => new Date(iso);

test("MemoryPhoto accepts each valid lifecycle state", async () => {
  const common = { ownerId: ownerId(), slot: 1 };
  const submittedAt = at("2026-10-25T05:00:00.000Z");
  const reviewedAt = at("2026-10-25T06:00:00.000Z");
  const documents = [
    new MemoryPhoto({
      ...common,
      status: "reserved",
      reservationToken: "reservation-token",
      reservationExpiresAt: at("2026-10-25T04:10:00.000Z"),
    }),
    new MemoryPhoto({ ...common, slot: 2, status: "pending", storageKey: "memory/u/2.jpg", submittedAt }),
    new MemoryPhoto({
      ...common, slot: 3, status: "approved", storageKey: "memory/u/3.jpg", submittedAt,
      reviewedBy: reviewerId(), reviewedAt,
    }),
    new MemoryPhoto({
      ...common, status: "rejected", storageKey: "memory/u/rejected.jpg", submittedAt,
      reviewedBy: reviewerId(), reviewedAt, rejectionReason: "Too dark",
    }),
  ];

  for (const document of documents) await document.validate();
});

test("MemoryPhoto rejects invalid slots and inconsistent lifecycle fields", async () => {
  const base = { ownerId: ownerId(), slot: 1 };
  const submittedAt = at("2026-10-25T05:00:00.000Z");
  const reviewedAt = at("2026-10-25T06:00:00.000Z");
  const invalid = [
    { ...base, slot: 0, status: "reserved", reservationToken: "t", reservationExpiresAt: reviewedAt },
    { ...base, slot: 4, status: "reserved", reservationToken: "t", reservationExpiresAt: reviewedAt },
    { ...base, slot: 1.5, status: "reserved", reservationToken: "t", reservationExpiresAt: reviewedAt },
    { ...base, status: "reserved", reservationExpiresAt: reviewedAt },
    { ...base, status: "reserved", reservationToken: "t" },
    { ...base, status: "reserved", reservationToken: "t", reservationExpiresAt: reviewedAt, storageKey: "not-allowed" },
    { ...base, status: "pending", storageKey: "key" },
    { ...base, status: "pending", storageKey: "key", submittedAt, reservationToken: "not-allowed" },
    { ...base, status: "approved", storageKey: "key", submittedAt, reviewedAt },
    { ...base, status: "approved", storageKey: "key", submittedAt, reviewedAt, reviewedBy: reviewerId(), rejectionReason: "not-allowed" },
    { ...base, status: "rejected", storageKey: "key", submittedAt, reviewedAt, reviewedBy: reviewerId() },
    { ...base, status: "rejected", storageKey: "key", submittedAt, reviewedBy: reviewerId(), rejectionReason: "reason" },
  ];

  for (const values of invalid) {
    await assert.rejects(new MemoryPhoto(values).validate());
  }
});

test("MemoryPhoto validates rejected moderation history without image data", async () => {
  const rejected = new MemoryPhoto({
    ownerId: ownerId(), slot: 1, status: "rejected", storageKey: "memory/current.jpg",
    submittedAt: at("2026-10-25T05:00:00.000Z"), reviewedBy: reviewerId(),
    reviewedAt: at("2026-10-25T06:00:00.000Z"), rejectionReason: "Current reason",
    moderationHistory: [{
      status: "rejected", storageKey: "memory/previous.jpg",
      submittedAt: at("2026-10-24T05:00:00.000Z"), reviewedBy: reviewerId(),
      reviewedAt: at("2026-10-24T06:00:00.000Z"), rejectionReason: "Previous reason",
      originalCreatedAt: at("2026-10-24T04:00:00.000Z"),
      originalUpdatedAt: at("2026-10-24T06:00:00.000Z"),
    }],
  });
  await rejected.validate();
  assert.equal(rejected.moderationHistory[0]._id, undefined);
  assert.equal(rejected.moderationHistory[0].image, undefined);

  rejected.moderationHistory[0].status = "approved";
  await assert.rejects(rejected.validate());
});

test("MemoryPhoto declares the owner-slot unique index", () => {
  const index = MemoryPhoto.schema.indexes().find(([keys]) => keys.ownerId === 1 && keys.slot === 1);
  assert.deepEqual(index, [{ ownerId: 1, slot: 1 }, { unique: true }]);
});

dbTest("MemoryPhoto database index rejects duplicate owner slots", async () => {
  const owner = ownerId();
  const reservation = {
    ownerId: owner, slot: 1, status: "reserved", reservationToken: "first",
    reservationExpiresAt: at("2026-10-25T06:00:00.000Z"),
  };
  await MemoryPhoto.create(reservation);
  await assert.rejects(MemoryPhoto.create({ ...reservation, reservationToken: "second" }), { code: 11000 });
});

test("MemoryPhotoLike declares required references and one-like-per-photo index", async () => {
  const like = new MemoryPhotoLike({ userId: ownerId(), photoId: ownerId() });
  await like.validate();
  await assert.rejects(new MemoryPhotoLike({ photoId: ownerId() }).validate());
  await assert.rejects(new MemoryPhotoLike({ userId: ownerId() }).validate());
  const index = MemoryPhotoLike.schema.indexes().find(([keys]) => keys.userId === 1 && keys.photoId === 1);
  assert.deepEqual(index, [{ userId: 1, photoId: 1 }, { unique: true }]);
  assert(MemoryPhotoLike.schema.indexes().some(([keys]) => Object.keys(keys).length === 1 && keys.photoId === 1));
});

dbTest("MemoryPhotoLike database index prevents duplicate likes", async () => {
  const like = { userId: ownerId(), photoId: ownerId() };
  await MemoryPhotoLike.create(like);
  await assert.rejects(MemoryPhotoLike.create(like), { code: 11000 });
});

test("MemoryPhotoSettings defaults to the disabled fixed-ID singleton without dates", async () => {
  const settings = new MemoryPhotoSettings();
  await settings.validate();
  assert.equal(settings._id, "memory-photo-settings");
  assert.equal(settings.enabled, false);
  assert.equal(settings.opensAt, null);
  assert.equal(settings.uploadsCloseAt, null);
  assert.equal(settings.likesCloseAt, null);
  assert.equal(settings.galleryClosesAt, null);
  await assert.rejects(new MemoryPhotoSettings({ _id: "another-settings" }).validate());
});

test("MemoryPhotoSettings requires an opening time only when explicitly enabled", async () => {
  await new MemoryPhotoSettings({ enabled: false }).validate();
  await assert.rejects(new MemoryPhotoSettings({ enabled: true }).validate());
  await new MemoryPhotoSettings({ enabled: true, opensAt: at("2026-10-25T03:30:00.000Z") }).validate();
});

test("MemoryPhotoSettings requires every configured closing time to follow opening", async () => {
  const opensAt = at("2026-10-25T03:30:00.000Z");
  for (const field of ["uploadsCloseAt", "likesCloseAt", "galleryClosesAt"]) {
    await assert.rejects(new MemoryPhotoSettings({ opensAt, [field]: new Date(opensAt) }).validate());
    await assert.rejects(new MemoryPhotoSettings({ opensAt, [field]: at("2026-10-25T03:29:59.999Z") }).validate());
    await new MemoryPhotoSettings({ opensAt, [field]: at("2026-10-25T03:30:00.001Z") }).validate();
  }
});

test("MemoryPhotoSettings rejects closing times when opening is absent even while disabled", async () => {
  await assert.rejects(new MemoryPhotoSettings({
    enabled: false,
    uploadsCloseAt: at("2026-10-26T03:30:00.000Z"),
  }).validate());
});

test("reservePhotoSlot rejects invalid dates and reservation lifetimes before database access", async () => {
  for (const input of [
    { ownerId: ownerId(), now: new Date("invalid"), reservationTtlMs: 1000 },
    { ownerId: ownerId(), now: new Date(), reservationTtlMs: 0 },
    { ownerId: ownerId(), now: new Date(), reservationTtlMs: -1 },
    { ownerId: ownerId(), now: new Date(), reservationTtlMs: Number.POSITIVE_INFINITY },
  ]) {
    await assert.rejects(reservePhotoSlot(input), { name: "TypeError" });
  }
});

dbTest("reservePhotoSlot allocates exactly three slots and returns a stable quota error", async () => {
  const owner = ownerId();
  const now = at("2026-10-25T04:00:00.000Z");
  const photos = [];
  for (let index = 0; index < 3; index += 1) {
    photos.push(await reservePhotoSlot({ ownerId: owner, now, reservationTtlMs: 60_000 }));
  }
  assert.deepEqual(photos.map((photo) => photo.slot), [1, 2, 3]);
  assert.equal(new Set(photos.map((photo) => photo.reservationToken)).size, 3);
  await assert.rejects(
    reservePhotoSlot({ ownerId: owner, now, reservationTtlMs: 60_000 }),
    (error) => error instanceof MemoryPhotoQuotaError && error.code === "MEMORY_PHOTO_QUOTA_FULL",
  );
  assert.equal(await MemoryPhoto.countDocuments({ ownerId: owner }), 3);
});

dbTest("concurrent reservations never allocate more than three indexed slots", async () => {
  const owner = ownerId();
  const now = at("2026-10-25T04:00:00.000Z");
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => (
    reservePhotoSlot({ ownerId: owner, now, reservationTtlMs: 60_000 })
  )));
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 3);
  assert.deepEqual(fulfilled.map((result) => result.value.slot).sort(), [1, 2, 3]);
  assert.equal(new Set(fulfilled.map((result) => result.value.reservationToken)).size, 3);
  assert.equal(rejected.length, 3);
  assert(rejected.every((result) => result.reason?.code === "MEMORY_PHOTO_QUOTA_FULL"));
  assert.equal(await MemoryPhoto.countDocuments({ ownerId: owner }), 3);
});

dbTest("reservation never overwrites pending or approved photos", async () => {
  const owner = ownerId();
  const submittedAt = at("2026-10-25T04:00:00.000Z");
  await MemoryPhoto.create([
    { ownerId: owner, slot: 1, status: "pending", storageKey: "memory/1.jpg", submittedAt },
    { ownerId: owner, slot: 2, status: "approved", storageKey: "memory/2.jpg", submittedAt, reviewedBy: reviewerId(), reviewedAt: at("2026-10-25T05:00:00.000Z") },
    { ownerId: owner, slot: 3, status: "pending", storageKey: "memory/3.jpg", submittedAt },
  ]);
  await assert.rejects(
    reservePhotoSlot({ ownerId: owner, now: at("2026-10-25T06:00:00.000Z"), reservationTtlMs: 60_000 }),
    { code: "MEMORY_PHOTO_QUOTA_FULL" },
  );
  assert.equal(await MemoryPhoto.countDocuments({ ownerId: owner, status: { $in: ["pending", "approved"] } }), 3);
});

dbTest("reservation claims a rejected slot and snapshots its complete moderation state once", async () => {
  const owner = ownerId();
  const submittedAt = at("2026-10-25T04:00:00.000Z");
  const reviewedAt = at("2026-10-25T05:00:00.000Z");
  const reviewer = reviewerId();
  const rejected = await MemoryPhoto.create({
    ownerId: owner, slot: 1, status: "rejected", storageKey: "memory/rejected.jpg",
    submittedAt, reviewedBy: reviewer, reviewedAt, rejectionReason: "Too dark",
  });
  const reserved = await reservePhotoSlot({
    ownerId: owner, now: at("2026-10-25T06:00:00.000Z"), reservationTtlMs: 60_000,
  });
  assert.equal(reserved._id.toString(), rejected._id.toString());
  assert.equal(reserved.status, "reserved");
  assert.equal(reserved.storageKey, null);
  assert.equal(reserved.moderationHistory.length, 1);
  assert.equal(reserved.moderationHistory[0].storageKey, "memory/rejected.jpg");
  assert.equal(reserved.moderationHistory[0].submittedAt.toISOString(), submittedAt.toISOString());
  assert.equal(reserved.moderationHistory[0].reviewedAt.toISOString(), reviewedAt.toISOString());
  assert.equal(reserved.moderationHistory[0].reviewedBy.toString(), reviewer.toString());
  assert.equal(reserved.moderationHistory[0].rejectionReason, "Too dark");
});

dbTest("reservation reclaims an expired reservation without duplicating history", async () => {
  const owner = ownerId();
  const history = [{
    status: "rejected", storageKey: "memory/old.jpg",
    submittedAt: at("2026-10-24T04:00:00.000Z"), reviewedBy: reviewerId(),
    reviewedAt: at("2026-10-24T05:00:00.000Z"), rejectionReason: "Old reason",
    originalCreatedAt: at("2026-10-24T03:00:00.000Z"), originalUpdatedAt: at("2026-10-24T05:00:00.000Z"),
  }];
  const expired = await MemoryPhoto.create({
    ownerId: owner, slot: 1, status: "reserved", reservationToken: "expired-token",
    reservationExpiresAt: at("2026-10-25T04:00:00.000Z"), moderationHistory: history,
  });
  const reserved = await reservePhotoSlot({
    ownerId: owner, now: at("2026-10-25T04:00:00.000Z"), reservationTtlMs: 60_000,
  });
  assert.equal(reserved._id.toString(), expired._id.toString());
  assert.notEqual(reserved.reservationToken, "expired-token");
  assert.equal(reserved.moderationHistory.length, 1);
  assert.equal(reserved.moderationHistory[0].storageKey, "memory/old.jpg");
});

dbTest("simultaneous claims of one rejected slot have one winner and one quota failure", async () => {
  const owner = ownerId();
  const submittedAt = at("2026-10-25T04:00:00.000Z");
  await MemoryPhoto.create([
    { ownerId: owner, slot: 1, status: "rejected", storageKey: "memory/rejected.jpg", submittedAt, reviewedBy: reviewerId(), reviewedAt: at("2026-10-25T05:00:00.000Z"), rejectionReason: "Reason" },
    { ownerId: owner, slot: 2, status: "pending", storageKey: "memory/2.jpg", submittedAt },
    { ownerId: owner, slot: 3, status: "approved", storageKey: "memory/3.jpg", submittedAt, reviewedBy: reviewerId(), reviewedAt: at("2026-10-25T05:00:00.000Z") },
  ]);
  const results = await Promise.allSettled(Array.from({ length: 2 }, () => (
    reservePhotoSlot({ ownerId: owner, now: at("2026-10-25T06:00:00.000Z"), reservationTtlMs: 60_000 })
  )));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.reason?.code === "MEMORY_PHOTO_QUOTA_FULL").length, 1);
  const slot = await MemoryPhoto.findOne({ ownerId: owner, slot: 1 });
  assert.equal(slot.status, "reserved");
  assert.equal(slot.moderationHistory.length, 1);
});

test("completion and release reject malformed arguments before database access", async () => {
  await assert.rejects(completePhotoReservation({
    photoId: "bad", ownerId: ownerId(), reservationToken: "token", storageKey: "key", now: new Date(),
  }), { name: "TypeError" });
  await assert.rejects(completePhotoReservation({
    photoId: ownerId(), ownerId: ownerId(), reservationToken: "", storageKey: "key", now: new Date(),
  }), { name: "TypeError" });
  await assert.rejects(completePhotoReservation({
    photoId: ownerId(), ownerId: ownerId(), reservationToken: "token", storageKey: " ", now: new Date(),
  }), { name: "TypeError" });
  await assert.rejects(releasePhotoReservation({
    photoId: ownerId(), ownerId: ownerId(), reservationToken: "",
  }), { name: "TypeError" });
});

dbTest("completion atomically moves a live reservation to pending", async () => {
  const owner = ownerId();
  const reserved = await reservePhotoSlot({
    ownerId: owner, now: at("2026-10-25T04:00:00.000Z"), reservationTtlMs: 60_000,
  });
  const now = at("2026-10-25T04:00:59.999Z");
  const completed = await completePhotoReservation({
    photoId: reserved._id, ownerId: owner, reservationToken: reserved.reservationToken,
    storageKey: " memory/new.jpg ", now,
  });
  assert.equal(completed.status, "pending");
  assert.equal(completed.storageKey, "memory/new.jpg");
  assert.equal(completed.submittedAt.toISOString(), now.toISOString());
  assert.equal(completed.reservationToken, null);
  assert.equal(completed.reservationExpiresAt, null);
  assert.equal(completed.reviewedBy, null);
  MemoryPhoto.assertState(completed);
});

dbTest("completion rejects expiry boundary, expired reservations, wrong owners, and stale tokens", async () => {
  const owner = ownerId();
  const expiresAt = at("2026-10-25T04:01:00.000Z");
  for (const now of [expiresAt, at("2026-10-25T04:01:00.001Z")]) {
    await MemoryPhoto.deleteMany({});
    const reserved = await reservePhotoSlot({
      ownerId: owner, now: at("2026-10-25T04:00:00.000Z"), reservationTtlMs: 60_000,
    });
    await assert.rejects(completePhotoReservation({
      photoId: reserved._id, ownerId: owner, reservationToken: reserved.reservationToken,
      storageKey: "memory/new.jpg", now,
    }), { code: "MEMORY_PHOTO_RESERVATION_EXPIRED" });
    assert.equal((await MemoryPhoto.findById(reserved._id)).status, "reserved");
  }
  await MemoryPhoto.deleteMany({});
  const reserved = await reservePhotoSlot({ ownerId: owner, now: at("2026-10-25T04:00:00.000Z"), reservationTtlMs: 60_000 });
  for (const change of [
    { ownerId: ownerId(), reservationToken: reserved.reservationToken },
    { ownerId: owner, reservationToken: "stale-token" },
  ]) {
    await assert.rejects(completePhotoReservation({
      photoId: reserved._id, ...change, storageKey: "memory/new.jpg", now: at("2026-10-25T04:00:30.000Z"),
    }), { code: "MEMORY_PHOTO_RESERVATION_STALE" });
  }
});

dbTest("an old completion token cannot mutate a reclaimed expired reservation", async () => {
  const owner = ownerId();
  const first = await reservePhotoSlot({ ownerId: owner, now: at("2026-10-25T04:00:00.000Z"), reservationTtlMs: 1_000 });
  const second = await reservePhotoSlot({ ownerId: owner, now: at("2026-10-25T04:00:01.000Z"), reservationTtlMs: 60_000 });
  assert.equal(first._id.toString(), second._id.toString());
  await assert.rejects(completePhotoReservation({
    photoId: first._id, ownerId: owner, reservationToken: first.reservationToken,
    storageKey: "memory/stale.jpg", now: at("2026-10-25T04:00:02.000Z"),
  }), { code: "MEMORY_PHOTO_RESERVATION_STALE" });
  assert.equal((await MemoryPhoto.findById(first._id)).reservationToken, second.reservationToken);
});

dbTest("completion explicitly applies the shared state invariant postcondition", async () => {
  const owner = ownerId();
  const reserved = await reservePhotoSlot({ ownerId: owner, now: at("2026-10-25T04:00:00.000Z"), reservationTtlMs: 60_000 });
  const actual = MemoryPhoto.assertState;
  MemoryPhoto.assertState = () => { throw new Error("invariant-postcondition"); };
  try {
    await assert.rejects(completePhotoReservation({
      photoId: reserved._id, ownerId: owner, reservationToken: reserved.reservationToken,
      storageKey: "memory/new.jpg", now: at("2026-10-25T04:00:30.000Z"),
    }), /invariant-postcondition/);
  } finally {
    MemoryPhoto.assertState = actual;
  }
});

dbTest("release deletes a fresh reservation and stale tokens cannot delete its replacement", async () => {
  const owner = ownerId();
  const first = await reservePhotoSlot({ ownerId: owner, now: at("2026-10-25T04:00:00.000Z"), reservationTtlMs: 60_000 });
  assert.deepEqual(await releasePhotoReservation({
    photoId: first._id, ownerId: owner, reservationToken: first.reservationToken,
  }), { released: true });
  assert.equal(await MemoryPhoto.findById(first._id), null);
  const second = await reservePhotoSlot({ ownerId: owner, now: at("2026-10-25T04:01:00.000Z"), reservationTtlMs: 60_000 });
  await assert.rejects(releasePhotoReservation({
    photoId: second._id, ownerId: owner, reservationToken: first.reservationToken,
  }), { code: "MEMORY_PHOTO_RESERVATION_STALE" });
  assert(await MemoryPhoto.findById(second._id));
});

dbTest("failed rejected replacement restores exact moderation state and preserves earlier history", async () => {
  const owner = ownerId();
  const reviewer = reviewerId();
  const submittedAt = at("2026-10-24T04:00:00.000Z");
  const reviewedAt = at("2026-10-24T05:00:00.000Z");
  const earlier = {
    status: "rejected", storageKey: "memory/earlier.jpg",
    submittedAt: at("2026-10-23T04:00:00.000Z"), reviewedBy: reviewerId(),
    reviewedAt: at("2026-10-23T05:00:00.000Z"), rejectionReason: "Earlier",
    originalCreatedAt: at("2026-10-23T03:00:00.000Z"), originalUpdatedAt: at("2026-10-23T05:00:00.000Z"),
  };
  const rejected = await MemoryPhoto.create({
    ownerId: owner, slot: 1, status: "rejected", storageKey: "memory/rejected.jpg",
    submittedAt, reviewedBy: reviewer, reviewedAt, rejectionReason: "Current", moderationHistory: [earlier],
  });
  const beforeUpdatedAt = rejected.updatedAt;
  const reserved = await reservePhotoSlot({ ownerId: owner, now: at("2026-10-25T04:00:00.000Z"), reservationTtlMs: 60_000 });
  assert.equal(reserved.moderationHistory.length, 2);
  await releasePhotoReservation({ photoId: reserved._id, ownerId: owner, reservationToken: reserved.reservationToken });
  const restored = await MemoryPhoto.findById(reserved._id);
  assert.equal(restored.status, "rejected");
  assert.equal(restored.storageKey, "memory/rejected.jpg");
  assert.equal(restored.submittedAt.toISOString(), submittedAt.toISOString());
  assert.equal(restored.reviewedBy.toString(), reviewer.toString());
  assert.equal(restored.reviewedAt.toISOString(), reviewedAt.toISOString());
  assert.equal(restored.rejectionReason, "Current");
  assert.equal(restored.moderationHistory.length, 1);
  assert.equal(restored.moderationHistory[0].storageKey, "memory/earlier.jpg");
  assert(restored.updatedAt > beforeUpdatedAt);
});

dbTest("successful rejected replacement keeps the prior rejection in moderation history", async () => {
  const owner = ownerId();
  const submittedAt = at("2026-10-24T04:00:00.000Z");
  const reviewedAt = at("2026-10-24T05:00:00.000Z");
  const rejected = await MemoryPhoto.create({
    ownerId: owner, slot: 1, status: "rejected", storageKey: "memory/rejected.jpg",
    submittedAt, reviewedBy: reviewerId(), reviewedAt, rejectionReason: "Reason",
  });
  const reserved = await reservePhotoSlot({ ownerId: owner, now: at("2026-10-25T04:00:00.000Z"), reservationTtlMs: 60_000 });
  const pending = await completePhotoReservation({
    photoId: reserved._id, ownerId: owner, reservationToken: reserved.reservationToken,
    storageKey: "memory/replacement.jpg", now: at("2026-10-25T04:00:30.000Z"),
  });
  assert.equal(pending.status, "pending");
  assert.equal(pending.moderationHistory.length, 1);
  const history = pending.moderationHistory[0];
  assert.equal(history.storageKey, rejected.storageKey);
  assert.equal(history.submittedAt.toISOString(), submittedAt.toISOString());
  assert.equal(history.reviewedAt.toISOString(), reviewedAt.toISOString());
  assert.equal(history.originalCreatedAt.toISOString(), rejected.createdAt.toISOString());
  assert.equal(history.originalUpdatedAt.toISOString(), rejected.updatedAt.toISOString());
});

dbTest("expiration recovery deletes fresh reservations, restores replacements, and leaves live reservations", async () => {
  const ownerA = ownerId();
  const ownerB = ownerId();
  const ownerC = ownerId();
  const fresh = await reservePhotoSlot({ ownerId: ownerA, now: at("2026-10-25T04:00:00.000Z"), reservationTtlMs: 1_000 });
  const rejected = await MemoryPhoto.create({
    ownerId: ownerB, slot: 1, status: "rejected", storageKey: "memory/rejected.jpg",
    submittedAt: at("2026-10-24T04:00:00.000Z"), reviewedBy: reviewerId(),
    reviewedAt: at("2026-10-24T05:00:00.000Z"), rejectionReason: "Reason",
  });
  const replacement = await reservePhotoSlot({ ownerId: ownerB, now: at("2026-10-25T04:00:00.000Z"), reservationTtlMs: 1_000 });
  const live = await reservePhotoSlot({ ownerId: ownerC, now: at("2026-10-25T04:00:00.000Z"), reservationTtlMs: 60_000 });
  const result = await recoverExpiredPhotoReservations({ now: at("2026-10-25T04:00:01.000Z") });
  assert.deepEqual(result, { recovered: 2 });
  assert.equal(await MemoryPhoto.findById(fresh._id), null);
  const restored = await MemoryPhoto.findById(replacement._id);
  assert.equal(restored.status, "rejected");
  assert.equal(restored.storageKey, rejected.storageKey);
  assert.equal(restored.moderationHistory.length, 0);
  assert.equal((await MemoryPhoto.findById(live._id)).status, "reserved");
});

dbTest("expiration recovery cannot affect a reservation that completion has transitioned to pending", async () => {
  const owner = ownerId();
  const reserved = await reservePhotoSlot({ ownerId: owner, now: at("2026-10-25T04:00:00.000Z"), reservationTtlMs: 60_000 });
  const completion = completePhotoReservation({
    photoId: reserved._id, ownerId: owner, reservationToken: reserved.reservationToken,
    storageKey: "memory/pending.jpg", now: at("2026-10-25T04:00:59.999Z"),
  });
  const recovery = completion.then(() => recoverExpiredPhotoReservations({ now: at("2026-10-25T04:01:00.000Z") }));
  const [, recoveryResult] = await Promise.all([completion, recovery]);
  assert.deepEqual(recoveryResult, { recovered: 0 });
  const pending = await MemoryPhoto.findById(reserved._id);
  assert.equal(pending.status, "pending");
  assert.equal(pending.storageKey, "memory/pending.jpg");
});
