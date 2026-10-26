const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const mongoose = require("mongoose");
const MemoryPhoto = require("../model/memoryPhotosModel");
const MemoryPhotoLike = require("../model/memoryPhotoLikesModel");
const User = require("../model/usersModel");
const Admin = require("../model/adminsModel");

let mongo;
let mongoExit;
let directory;

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "memory-photo-models-"));
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  mongo = spawn(process.env.MONGOD_BINARY || "mongod", [
    "--bind_ip", "127.0.0.1", "--port", String(port),
    "--dbpath", directory, "--logpath", path.join(directory, "mongod.log"),
  ], { stdio: "ignore" });
  let spawnError;
  mongo.on("error", (error) => { spawnError = error; });
  mongoExit = new Promise((resolve) => mongo.once("exit", resolve));
  const client = new mongoose.mongo.MongoClient(`mongodb://127.0.0.1:${port}`, {
    directConnection: true, serverSelectionTimeoutMS: 300,
  });
  try {
    for (let attempt = 0; ; attempt++) {
      try { await client.connect(); break; } catch (error) {
        if (spawnError || mongo.exitCode !== null || attempt >= 50) {
          throw new Error(`Cannot start temporary mongod: ${spawnError?.message || error.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  } finally { await client.close(); }
  await mongoose.connect(`mongodb://127.0.0.1:${port}/memory_photo_models_test`);
  await Promise.all([MemoryPhoto.init(), MemoryPhotoLike.init(), User.init(), Admin.init()]);
}, { timeout: 30000 });

after(async () => {
  await mongoose.disconnect();
  if (mongo?.pid && mongo.exitCode === null) {
    mongo.kill("SIGTERM");
    await mongoExit;
  }
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

const objectId = () => new mongoose.Types.ObjectId();
const photoInput = () => ({ owner: objectId(), imageKey: "private/memory/example.jpg" });

test("MemoryPhoto defaults to PENDING with a storage key and optional review metadata", async () => {
  const photo = new MemoryPhoto(photoInput());
  await photo.validate();
  assert.equal(photo.status, "PENDING");
  assert(photo.createdAt instanceof Date);
  assert.equal(photo.imageKey, "private/memory/example.jpg");
  assert.equal(photo.reviewedBy, undefined);
  assert.equal(photo.reviewedAt, undefined);
  assert.equal(MemoryPhoto.schema.path("url"), undefined);
});

test("MemoryPhoto validates required fields, statuses, IDs, and dates", async () => {
  for (const field of ["owner", "imageKey"]) {
    const input = photoInput();
    delete input[field];
    await assert.rejects(new MemoryPhoto(input).validate(), { name: "ValidationError" });
  }
  for (const invalid of [
    { imageKey: "   " }, { owner: "invalid" }, { status: "pending" },
    { status: "UNKNOWN" }, { status: null }, { reviewedBy: "invalid" },
    { createdAt: "invalid" }, { createdAt: null }, { reviewedAt: "invalid" },
  ]) {
    await assert.rejects(new MemoryPhoto({ ...photoInput(), ...invalid }).validate(), { name: "ValidationError" });
  }
  for (const status of ["PENDING", "APPROVED", "REJECTED"]) {
    await new MemoryPhoto({ ...photoInput(), status }).validate();
  }
});

test("MemoryPhoto and likes reference the existing User, Admin, and MemoryPhoto models", async () => {
  assert.equal(MemoryPhoto.schema.path("owner").options.ref, "User");
  assert.equal(MemoryPhoto.schema.path("reviewedBy").options.ref, "Admin");
  assert.equal(MemoryPhotoLike.schema.path("photoId").options.ref, "MemoryPhoto");
  assert.equal(MemoryPhotoLike.schema.path("userId").options.ref, "User");
  const owner = await User.create({ email: "modelowner@gmail.com", emailKey: "modelowner@gmail.com", emailVerifiedAt: new Date(), passwordHash: "test-only-hash" });
  const admin = await Admin.create({ username: "model-reviewer", passwordHash: "test-only-hash", role: "memory_admin" });
  const reviewedAt = new Date("2026-10-18T00:00:00Z");
  const photo = await MemoryPhoto.create({
    owner: owner._id, imageKey: "private/reviewed.png", status: "APPROVED",
    reviewedBy: admin._id, reviewedAt,
  });
  const loaded = await MemoryPhoto.findById(photo._id).populate("owner reviewedBy");
  assert.equal(loaded.owner.email, owner.email);
  assert.equal(loaded.reviewedBy.username, admin.username);
  assert.equal(+loaded.reviewedAt, +reviewedAt);
  const like = await MemoryPhotoLike.create({ photoId: photo._id, userId: owner._id });
  const populatedLike = await MemoryPhotoLike.findById(like._id).populate("photoId userId");
  assert.equal(populatedLike.photoId.imageKey, photo.imageKey);
  assert.equal(populatedLike.userId.email, owner.email);
  assert(populatedLike.createdAt instanceof Date);
});

test("MemoryPhoto indexes support owner history and moderation without expiring rejected submissions", async () => {
  const indexes = await MemoryPhoto.collection.indexes();
  assert(indexes.some((index) => JSON.stringify(index.key) === JSON.stringify({ owner: 1, createdAt: -1 })));
  assert(indexes.some((index) => JSON.stringify(index.key) === JSON.stringify({ status: 1, createdAt: -1 })));
  assert(indexes.every((index) => index.expireAfterSeconds === undefined && index.partialFilterExpression === undefined));
  const owner = objectId();
  for (const status of ["PENDING", "APPROVED", "REJECTED"]) {
    await MemoryPhoto.create({ owner, imageKey: `private/${status}.jpg`, status });
  }
  assert.equal(await MemoryPhoto.countDocuments({ owner }), 3);
  assert.equal(await MemoryPhoto.countDocuments({ owner, status: "REJECTED" }), 1);
});

test("MemoryPhotoLike requires valid user/photo references and createdAt", async () => {
  for (const input of [
    {}, { photoId: objectId() }, { userId: objectId() },
    { photoId: "invalid", userId: objectId() },
    { photoId: objectId(), userId: "invalid" },
    { photoId: objectId(), userId: objectId(), createdAt: "invalid" },
    { photoId: objectId(), userId: objectId(), createdAt: null },
  ]) {
    await assert.rejects(new MemoryPhotoLike(input).validate(), { name: "ValidationError" });
  }
});

test("MongoDB uniquely enforces one like per photo and user, including concurrent writes", async () => {
  const indexes = await MemoryPhotoLike.collection.indexes();
  assert(indexes.some((index) => index.unique === true
    && JSON.stringify(index.key) === JSON.stringify({ photoId: 1, userId: 1 })));
  const pair = { photoId: objectId(), userId: objectId() };
  const outcomes = await Promise.allSettled([MemoryPhotoLike.create(pair), MemoryPhotoLike.create(pair)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const duplicate = outcomes.find((outcome) => outcome.status === "rejected");
  assert.equal(duplicate.reason.code, 11000);
  assert.equal(await MemoryPhotoLike.countDocuments(pair), 1);
  await MemoryPhotoLike.create({ ...pair, userId: objectId() });
  await MemoryPhotoLike.create({ ...pair, photoId: objectId() });
});
