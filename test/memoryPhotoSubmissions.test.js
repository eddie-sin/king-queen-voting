const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const sharp = require("sharp");

const directory = require("node:fs").mkdtempSync(path.join(os.tmpdir(), "memory-photo-submissions-"));
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.LOCAL_UPLOAD_DIR = path.join(directory, "public");
process.env.MEMORY_PHOTO_UPLOAD_DIR = path.join(directory, "private");
const app = require("../app");
const User = require("../model/usersModel");
const Controls = require("../model/eventControlsModel");
const { createUser, studentToken, headers: authHeaders } = require("./helpers/accounts.cjs");
const MemoryPhoto = require("../model/memoryPhotosModel");
const Quota = require("../model/memoryPhotoQuotasModel");
const quota = require("../utils/memoryPhotoQuota");
const storage = require("../utils/memoryPhotoStorage");
const AppError = require("../utils/appError");
let mongo;
let mongoExit;
let server;
let base;
let user;
let token;
let png;

const freePort = async () => {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
};

before(async () => {
  const databasePath = path.join(directory, "mongo");
  await fs.mkdir(databasePath);
  const port = await freePort();
  mongo = spawn(process.env.MONGOD_BINARY || "mongod", [
    "--replSet", "isolatedTests", "--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", databasePath,
    "--logpath", path.join(databasePath, "mongod.log"),
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
    await require("./helpers/replica.cjs").initialize(client, port);
  } finally { await client.close(); }
  await mongoose.connect(`mongodb://127.0.0.1:${port}/memory_photo_submissions_test`);
  await Promise.all([...Object.values(mongoose.models).map(model => model.init()), Controls.init(), MemoryPhoto.init(), Quota.init()]);
  png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).png().toBuffer();
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 30000 });

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Controls.deleteMany({}), MemoryPhoto.deleteMany({}), Quota.deleteMany({})]);
  await fs.rm(process.env.MEMORY_PHOTO_UPLOAD_DIR, { recursive: true, force: true });
  user = await createUser({ email: "student@gmail.com", passwordHash: "test-only-hash" });
  token = await studentToken(user);
  await Controls.create({ _id: "event", memoryPhotosEnabled: true });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo?.pid && mongo.exitCode === null) { mongo.kill("SIGTERM"); await mongoExit; }
  await fs.rm(directory, { recursive: true, force: true });
});

const submit = async ({ auth = token, bytes = png, type = "image/png", count = 1, field = "images", fields = {} } = {}) => {
  const form = new FormData();
  for (let index = 0; index < count; index++) form.append(field, new Blob([bytes], { type }), "photo.png");
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const response = await fetch(`${base}/api/v1/memory-photos`, {
    method: "POST", headers: authHeaders(auth), body: form,
  });
  return { status: response.status, body: await response.json() };
};
const files = async () => {
  try { return await fs.readdir(path.join(process.env.MEMORY_PHOTO_UPLOAD_DIR, "memory-photos")); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
};

const mine = async (auth = token, query = "") => {
  const response = await fetch(`${base}/api/v1/memory-photos/mine${query}`, {
    headers: authHeaders(auth),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
};

test("My Memories requires an active student, rejecting anonymous, forged, expired and admin tokens", async () => {
  assert.equal((await mine(null)).status, 401);
  assert.equal((await mine("not-a-token")).status, 401);
  const expired = await studentToken(user, {expired: true});
  assert.equal((await mine(expired)).status, 401);
  for (const adminRole of ["admin", "memory_admin"]) {
    const adminToken = jwt.sign({ adminId: String(new mongoose.Types.ObjectId()), role: "admin", adminRole }, process.env.JWT_SECRET);
    assert.equal((await mine(adminToken)).status, 401);
  }
  await User.updateOne({ _id: user._id }, { status: "disabled" });
  assert.equal((await mine()).status, 401);
  await User.deleteOne({ _id: user._id });
  assert.equal((await mine()).status, 401);
});

test("My Memories returns only the cookie session owner's safe metadata in deterministic newest-first order", async () => {
  const other = await createUser({ email: "mine-other@gmail.com", passwordHash: "test-only-hash" });
  const reviewer = new mongoose.Types.ObjectId();
  const sameDate = new Date("2026-10-22T00:00:00Z");
  const saved = await MemoryPhoto.create(["PENDING", "APPROVED", "REJECTED"].map((status, index) => ({
    owner: user._id, imageKey: `private-never-exposed-${index}`, status,
    createdAt: index === 0 ? new Date("2026-10-21") : sameDate,
    reviewedBy: reviewer, reviewedAt: sameDate,
  })));
  await MemoryPhoto.create({ owner: other._id, imageKey: "other-private-key" });
  await Quota.create({ _id: user._id, slots: saved.map(photo => photo._id) });
  const response = await mine();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.match(response.headers.get("vary"), /Cookie/);
  const expected = [...saved].sort((a, b) => +b.createdAt - +a.createdAt || String(b._id).localeCompare(String(a._id)));
  assert.deepEqual(response.body.data.photos.map(photo => photo.id), expected.map(photo => String(photo._id)));
  assert.equal(response.body.results, 3);
  assert.deepEqual(new Set(response.body.data.photos.map(photo => photo.status)), new Set(["PENDING", "APPROVED", "REJECTED"]));
  for (const photo of response.body.data.photos) assert.deepEqual(Object.keys(photo).sort(), ["createdAt", "id", "status"]);
  assert.deepEqual(response.body.data.quota, { limit: 3, acceptedCount: 2, remainingSlots: 1 });
  for (const query of [`?userId=${other._id}`, `?owner=${other._id}`, "?status=APPROVED"]) assert.equal((await mine(token, query)).status, 400);
  const otherToken = await studentToken(other);
  const own = await mine(otherToken);
  assert.equal(own.body.results, 1);
  assert(!own.body.data.photos.some(photo => saved.some(item => String(item._id) === photo.id)));
});

test("My Memories uses legacy records without creating quota state and handles an empty history", async () => {
  assert.deepEqual((await mine()).body.data, { photos: [], quota: { limit: 3, acceptedCount: 0, remainingSlots: 3 } });
  await MemoryPhoto.create({ owner: user._id, imageKey: "legacy", status: "REJECTED" });
  assert.deepEqual((await mine()).body.data.quota, { limit: 3, acceptedCount: 0, remainingSlots: 3 });
  assert.equal((await Quota.find()).reduce((n,q)=>n+q.slots.length,0), 0);
});

test("My Memories excludes cancellation markers while retaining unresolved reservation capacity", async () => {
  const failed = new mongoose.Types.ObjectId();
  await quota.reserve(user._id, failed);
  await quota.release(user._id, failed);
  const converted = await MemoryPhoto.create({ owner: user._id, imageKey: "cancelled-key", status: "APPROVED" });
  await quota.cancel(user._id, converted._id);
  assert.equal(await MemoryPhoto.collection.countDocuments({ owner: user._id, cancelled: true }), 2);
  assert.deepEqual((await mine()).body.data, { photos: [], quota: { limit: 3, acceptedCount: 0, remainingSlots: 3 } });
  const accepted = await submit();
  assert.equal(accepted.status, 201);
  const unresolved = new mongoose.Types.ObjectId();
  await quota.reserve(user._id, unresolved);
  const response = await mine();
  assert.equal(response.body.results, 1);
  assert.deepEqual(response.body.data.quota, { limit: 3, acceptedCount: 2, remainingSlots: 1 });
  assert.equal((await Quota.findById(user._id)).slots.length, 2);
  // A missing record alone cannot prove completion or free an unresolved reservation.
  await MemoryPhoto.deleteOne({ _id: accepted.body.data.photo.id });
  assert.deepEqual((await mine()).body.data.quota, { limit: 3, acceptedCount: 2, remainingSlots: 1 });
});

test("My Memories remains disabled for false, missing and absent feature settings", async () => {
  await MemoryPhoto.create({ owner: user._id, imageKey: "hidden-when-disabled" });
  await Controls.updateOne({}, { memoryPhotosEnabled: false });
  assert.equal((await mine()).status, 403);
  await Controls.collection.updateOne({}, { $unset: { memoryPhotosEnabled: "" } });
  assert.equal((await mine()).status, 403);
  await Controls.deleteMany({});
  assert.equal((await mine()).status, 403);
});

test("My Memories rechecks the feature after reading and propagates database errors safely", async () => {
  const find = MemoryPhoto.find;
  MemoryPhoto.find = function (...args) {
    const query = find.apply(this, args);
    const lean = query.lean;
    query.lean = async function (...options) {
      const photos = await lean.apply(this, options);
      await Controls.updateOne({}, { memoryPhotosEnabled: false });
      return photos;
    };
    return query;
  };
  try { assert.equal((await mine()).status, 403); }
  finally { MemoryPhoto.find = find; }
  await Controls.updateOne({}, { memoryPhotosEnabled: true });
  MemoryPhoto.find = () => { throw new Error("private-database-detail"); };
  try {
    const response = await mine();
    assert.equal(response.status, 500);
    assert(!JSON.stringify(response.body).includes("private-database-detail"));
  } finally { MemoryPhoto.find = find; }
});

test("only active authenticated students may submit; admins and anonymous callers are rejected", async () => {
  assert.equal((await submit({ auth: null })).status, 401);
  assert.equal((await submit({ auth: "invalid-token" })).status, 401);
  const admin = jwt.sign({ adminId: new mongoose.Types.ObjectId().toString(), role: "admin", v: 0 }, process.env.JWT_SECRET);
  assert.equal((await submit({ auth: admin })).status, 401);
  await User.updateOne({ _id: user._id }, { status: "disabled" });
  assert.equal((await submit()).status, 401);
  assert.equal(await MemoryPhoto.countDocuments(), 0);
  assert.equal((await Quota.find()).reduce((n,q)=>n+q.slots.length,0), 0);
  assert.deepEqual(await files(), []);
});

test("disabled, missing and legacy feature settings reject uploads before buffering or storage", async () => {
  await Controls.updateOne({}, { memoryPhotosEnabled: false });
  assert.equal((await submit({ bytes: Buffer.alloc(6 * 1024 * 1024) })).status, 403);
  await Controls.collection.updateOne({}, { $unset: { memoryPhotosEnabled: "" } });
  assert.equal((await submit()).status, 403);
  await Controls.deleteMany({});
  assert.equal((await submit()).status, 403);
  assert.equal((await Quota.find()).reduce((n,q)=>n+q.slots.length,0), 0);
  assert.deepEqual(await files(), []);
});

test("successful submission stores a private PENDING image and exposes only ID, status and timestamp", async () => {
  const response = await submit();
  assert.equal(response.status, 201);
  const photo = response.body.data.photo;
  assert.deepEqual(Object.keys(photo).sort(), ["createdAt", "id", "status"]);
  assert.equal(photo.status, "PENDING");
  assert(Number.isFinite(Date.parse(photo.createdAt)));
  const saved = await MemoryPhoto.findById(photo.id);
  assert.equal(saved.owner.toString(), user._id.toString());
  assert.match(saved.imageKey, /^memory-photos\//);
  assert.equal(saved.reviewedAt, undefined);
  assert.equal(saved.reviewedBy, undefined);
  assert.equal((await Quota.findById(user._id)).slots.length, 1);
  assert.equal((await storage.getImage(saved.imageKey)).contentType, "image/png");
  assert.equal((await fetch(`${base}/uploads/${saved.imageKey}`)).status, 404);
});

test("one image is required; oversized, malformed, mismatched and extra fields do not consume quota", async () => {
  const jpeg = await sharp(png).jpeg().toBuffer();
  const gif = await sharp(png).gif().toBuffer();
  for (const options of [
    { count: 0 }, { count: 2 }, { field: "photo" }, { bytes: Buffer.alloc(0) },
    { bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }, { type: "text/html" },
    { bytes: Buffer.from("<html>fake image</html>") }, { bytes: jpeg, type: "image/png" },
    { bytes: gif, type: "image/png" }, { bytes: png.subarray(0, 40) },
    { fields: { owner: new mongoose.Types.ObjectId().toString(), status: "APPROVED" } },
  ]) assert.equal((await submit(options)).status, 400, JSON.stringify({ ...options, bytes: undefined }));
  assert.equal((await Quota.find()).reduce((n,q)=>n+q.slots.length,0), 0);
  assert.equal(await MemoryPhoto.countDocuments(), 0);
  assert.deepEqual(await files(), []);
});

test("real JPEG and WebP content is accepted and stored with the validated format", async () => {
  for (const [format, type] of [["jpeg", "image/jpeg"], ["webp", "image/webp"]]) {
    const bytes = await sharp(png).toFormat(format).toBuffer();
    const response = await submit({ bytes, type });
    assert.equal(response.status, 201);
    const photo = await MemoryPhoto.findById(response.body.data.photo.id);
    assert.equal((await storage.getImage(photo.imageKey)).contentType, type);
  }
});

test("rejected records free a slot, while deleting active image bytes alone does not release capacity", async () => {
  for (const status of ["PENDING", "APPROVED", "REJECTED"]) {
    const result = await submit();
    assert.equal(result.status, 201);
    await MemoryPhoto.updateOne({ _id: result.body.data.photo.id }, { status });
  }
  for (const photo of await MemoryPhoto.find()) await storage.deleteImage(photo.imageKey);
  assert.equal((await submit()).status, 201);
  assert.equal((await submit()).status, 409);
  assert.equal(await MemoryPhoto.countDocuments(), 4);
  assert.equal((await Quota.findById(user._id)).slots.length, 3);
});

test("legacy quota initialization counts pending and approved photos but releases rejected history", async () => {
  await MemoryPhoto.create(["PENDING", "APPROVED", "REJECTED"].map((status) => ({ owner: user._id, imageKey: `old/${status}`, status })));
  assert.equal((await submit()).status, 201);
  assert.equal((await submit()).status, 409);
  assert.equal((await Quota.findById(user._id)).slots.length, 3);
});

test("archived photos retain capacity before and after legacy quota initialization", async () => {
  const photos = await MemoryPhoto.create(Array.from({ length: 3 }, (_, index) => ({
    owner: user._id, imageKey: `legacy/archive-${index}`, status: "APPROVED", archived: true,
  })));
  const expected = { limit: 3, acceptedCount: 3, remainingSlots: 0 };
  const history = await mine();
  assert.deepEqual(history.body.data.quota, expected);
  assert(history.body.data.photos.every(photo => photo.status === "ARCHIVED"));
  assert.equal((await Quota.find()).reduce((n,q)=>n+q.slots.length,0), 0);
  assert.equal((await submit()).status, 409);
  assert.deepEqual(new Set((await Quota.findById(user._id)).slots.map(String)), new Set(photos.map(photo => String(photo._id))));
  assert.deepEqual((await mine()).body.data.quota, expected);
});

test("legacy rejected and deleted slots reconcile without freeing archived or unresolved slots", async () => {
  const archived = await MemoryPhoto.create({ owner: user._id, imageKey: "legacy/archived", status: "APPROVED", archived: true });
  const rejected = await MemoryPhoto.create({ owner: user._id, status: "REJECTED" });
  const deleted = await MemoryPhoto.create({ owner: user._id, status: "APPROVED", deletedAt: new Date() });
  const unresolved = new mongoose.Types.ObjectId();
  await Quota.create({ _id: user._id, slots: [archived._id, rejected._id, deleted._id, unresolved] });
  assert.deepEqual((await mine()).body.data.quota, { limit: 3, acceptedCount: 2, remainingSlots: 1 });
  const responses = await Promise.all(Array.from({ length: 6 }, () => submit()));
  assert.equal(responses.filter(response => response.status === 201).length, 1);
  assert.equal(responses.filter(response => response.status === 409).length, 5);
  const slots = (await Quota.findById(user._id)).slots.map(String);
  assert.equal(slots.length, 3);
  assert(slots.includes(String(archived._id)) && slots.includes(String(unresolved)));
  assert(!slots.includes(String(rejected._id)) && !slots.includes(String(deleted._id)));
  assert.deepEqual((await mine()).body.data.quota, { limit: 3, acceptedCount: 3, remainingSlots: 0 });
});

test("twelve concurrent requests atomically accept exactly three submissions", async () => {
  const responses = await Promise.all(Array.from({ length: 12 }, () => submit()));
  assert.equal(responses.filter((response) => response.status === 201).length, 3);
  assert.equal(responses.filter((response) => response.status === 409).length, 9);
  assert.equal(await MemoryPhoto.countDocuments({ owner: user._id }), 3);
  assert.equal((await Quota.findById(user._id)).slots.length, 3);
  assert.equal((await files()).length, 3);
});

test("storage failures release their reservations without exposing storage details", async () => {
  const original = storage.uploadImage;
  storage.uploadImage = async () => { throw new Error("secret-private-storage-key"); };
  try {
    const failed = await Promise.all(Array.from({ length: 3 }, () => submit()));
    assert(failed.every((response) => response.status === 503));
    assert(!JSON.stringify(failed).includes("secret-private-storage-key"));
    assert.equal((await Quota.findById(user._id)).slots.length, 0);
    assert.equal(await MemoryPhoto.countDocuments(), 0);
  } finally { storage.uploadImage = original; }
  for (let index = 0; index < 3; index++) assert.equal((await submit()).status, 201);
});

test("failed persistence cleans up the image and releases quota, even after an acknowledged save", async () => {
  const original = MemoryPhoto.prototype.save;
  for (const commitFirst of [false, true]) {
    MemoryPhoto.prototype.save = async function (...args) {
      if (commitFirst) await original.apply(this, args);
      throw new AppError("Injected save failure", 503);
    };
    try {
      assert.equal((await submit()).status, 503);
      assert.equal(await MemoryPhoto.countDocuments(), 0);
      assert.equal((await Quota.findById(user._id)).slots.length, 0);
      assert.deepEqual(await files(), []);
    } finally { MemoryPhoto.prototype.save = original; }
  }
  assert.equal((await submit()).status, 201);
});

test("a failed request releases only its reservation while overlapping uploads succeed", async () => {
  const original = storage.uploadImage;
  let calls = 0;
  storage.uploadImage = async (...args) => {
    if (++calls === 1) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      throw new Error("Injected upload failure");
    }
    return original(...args);
  };
  try {
    const responses = await Promise.all([submit(), submit(), submit()]);
    assert.equal(responses.filter((response) => response.status === 201).length, 2);
    assert.equal(responses.filter((response) => response.status === 503).length, 1);
    assert.equal((await Quota.findById(user._id)).slots.length, 2);
  } finally { storage.uploadImage = original; }
  assert.equal((await submit()).status, 201);
  assert.equal((await submit()).status, 409);
  const accepted = await MemoryPhoto.find();
  const slots = (await Quota.findById(user._id)).slots.map(String).sort();
  assert.deepEqual(slots, accepted.map((photo) => String(photo._id)).sort());
  const unused = new mongoose.Types.ObjectId();
  await quota.release(user._id, unused);
  await quota.release(user._id, unused);
  assert.equal((await submit()).status, 409);
});

test("disabling during storage rejects the upload and rolls back file and reservation", async () => {
  const original = storage.uploadImage;
  storage.uploadImage = async (...args) => {
    const key = await original(...args);
    await Controls.updateOne({}, { memoryPhotosEnabled: false });
    return key;
  };
  try {
    assert.equal((await submit()).status, 403);
    assert.equal(await MemoryPhoto.countDocuments(), 0);
    assert.equal((await Quota.findById(user._id)).slots.length, 0);
    assert.deepEqual(await files(), []);
  } finally { storage.uploadImage = original; }
});

test("an unconfirmed database rollback retains the reservation rather than risking excess submissions", async () => {
  const save = MemoryPhoto.prototype.save;
  const remove = quota.cancel;
  let delayed;
  MemoryPhoto.prototype.save = async function () { delayed = this.toObject(); throw new Error("Injected save failure"); };
  quota.cancel = async () => { throw new Error("Injected rollback failure"); };
  try {
    assert.equal((await submit()).status, 503);
    assert.equal((await Quota.findById(user._id)).slots.length, 1);
    assert.equal((await files()).length, 1);
  } finally {
    MemoryPhoto.prototype.save = save;
    quota.cancel = remove;
  }
  await MemoryPhoto.collection.insertOne(delayed);
  assert.equal((await submit()).status, 201);
  assert.equal((await submit()).status, 201);
  assert.equal((await submit()).status, 409);
  assert.equal(await MemoryPhoto.countDocuments(), 3);
});

test("image cleanup failure does not consume quota after confirmed database rollback", async () => {
  const save = MemoryPhoto.prototype.save;
  const remove = storage.deleteImage;
  MemoryPhoto.prototype.save = async () => { throw new Error("Injected save failure"); };
  storage.deleteImage = async () => { throw new Error("Injected cleanup failure"); };
  try {
    assert.equal((await submit()).status, 503);
    assert.equal(await MemoryPhoto.countDocuments(), 0);
    assert.equal((await Quota.findById(user._id)).slots.length, 0);
  } finally {
    MemoryPhoto.prototype.save = save;
    storage.deleteImage = remove;
  }
  assert.equal((await submit()).status, 201);
});

test("each student has an independent quota and accepted IDs survive model reloads", async () => {
  for (let index = 0; index < 3; index++) assert.equal((await submit()).status, 201);
  const second = await createUser({ email: "second@gmail.com", passwordHash: "test-only-hash" });
  const secondToken = await studentToken(second);
  assert.equal((await submit({ auth: secondToken })).status, 201);
  // Read using an independent connection/model, as a new worker would.
  const connection = await mongoose.createConnection(mongoose.connection.client.s.url).asPromise();
  try {
    const independent = connection.model("MemoryPhotoQuota", Quota.schema);
    assert.equal((await independent.findById(user._id)).slots.length, 3);
    assert.equal((await independent.findById(second._id)).slots.length, 1);
  } finally { await connection.close(); }
  assert.equal((await submit()).status, 409);
});

test("failed insert IDs remain fenced against a late insert after quota release", async () => {
  const save = MemoryPhoto.prototype.save;
  let delayed;
  MemoryPhoto.prototype.save = async function () {
    delayed = this.toObject();
    throw new Error("Simulated timeout while the original insert is still in flight");
  };
  try { assert.equal((await submit()).status, 503); }
  finally { MemoryPhoto.prototype.save = save; }
  // Deterministically deliver the original write only after compensation.
  let lateError;
  try { await MemoryPhoto.collection.insertOne(delayed); }
  catch (error) { lateError = error; }
  assert.equal(lateError?.code, 11000, "The same _id must stay occupied by a durable cancellation fence");
  for (let index = 0; index < 3; index++) assert.equal((await submit()).status, 201);
  assert.equal(await MemoryPhoto.countDocuments({ owner: user._id }), 3);
  assert.equal((await Quota.findById(user._id)).slots.length, 3);
  assert.equal((await submit()).status, 409);
});

test("a delayed insert cannot free its slot until durable cancellation completes", async () => {
  const save = MemoryPhoto.prototype.save;
  const cancel = quota.cancel;
  let delayed;
  let entered;
  let resume;
  const reached = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { resume = resolve; });
  MemoryPhoto.prototype.save = async function () {
    delayed = this.toObject();
    throw new Error("Uncertain insert");
  };
  quota.cancel = async (...args) => { entered(); await gate; return cancel(...args); };
  const pending = submit();
  try {
    await reached;
    assert.equal((await Quota.findById(user._id)).slots.length, 1);
    assert.equal((await files()).length, 1);
    // The original insert wins this ordering, but cancellation must hide it.
    await MemoryPhoto.collection.insertOne(delayed);
    resume();
    assert.equal((await pending).status, 503);
    assert.equal(await MemoryPhoto.countDocuments(), 0);
    assert.equal(await MemoryPhoto.findById(delayed._id), null);
    assert.equal(await MemoryPhoto.exists({ _id: delayed._id }), null);
    assert.equal(await MemoryPhoto.findOneAndUpdate({ _id: delayed._id }, { status: "APPROVED" }), null);
    const Admin = require("../model/adminsModel");
    const admin = await Admin.create({ username: "cancellation-review-test", role: "admin", passwordHash: "test-only-hash" });
    const adminToken = jwt.sign({ adminId: String(admin._id), role: "admin", v: 0 }, process.env.JWT_SECRET);
    const headers = { Authorization: `Bearer ${adminToken}` };
    const queue = await fetch(`${base}/api/v1/admin/memory-photos`, { headers });
    assert.equal(queue.status, 200);
    assert.deepEqual((await queue.json()).data.photos, []);
    assert.equal((await fetch(`${base}/api/v1/admin/memory-photos/${delayed._id}/image`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/api/v1/admin/memory-photos/${delayed._id}/review`, {
      method: "PATCH", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "APPROVED" }),
    })).status, 404);
    // Even a cancelled record with APPROVED status remains invisible everywhere.
    await MemoryPhoto.collection.updateOne({ _id: delayed._id }, { $set: { status: "APPROVED" } });
    const gallery = await fetch(`${base}/api/v1/memory-photos`);
    assert.equal(gallery.status, 200);
    assert.deepEqual((await gallery.json()).data.photos, []);
    assert.equal((await fetch(`${base}/api/v1/memory-photos/${delayed._id}/image`)).status, 404);
    assert.equal((await fetch(`${base}/api/v1/memory-photos/${delayed._id}/like`, {
      method: "POST", headers: authHeaders(token),
    })).status, 404);
    assert.equal((await Quota.findById(user._id)).slots.length, 0);
  } finally {
    resume();
    await pending;
    MemoryPhoto.prototype.save = save;
    quota.cancel = cancel;
  }
});

test("lost cancellation acknowledgement retains quota, then safely recovers on retry", async () => {
  const save = MemoryPhoto.prototype.save;
  const update = MemoryPhoto.collection.updateOne;
  let delayed;
  MemoryPhoto.prototype.save = async function () { delayed = this.toObject(); throw new Error("Insert timeout"); };
  MemoryPhoto.collection.updateOne = async function (...args) {
    assert.deepEqual(args[2].writeConcern, { w: "majority", j: true });
    await update.apply(this, args);
    throw new Error("Cancellation committed but acknowledgement lost");
  };
  try {
    assert.equal((await submit()).status, 503);
    assert.equal((await Quota.findById(user._id)).slots.length, 1);
    assert.equal((await files()).length, 1);
  } finally {
    MemoryPhoto.prototype.save = save;
    MemoryPhoto.collection.updateOne = update;
  }
  await assert.rejects(MemoryPhoto.collection.insertOne(delayed), { code: 11000 });
  for (let index = 0; index < 3; index++) assert.equal((await submit()).status, 201);
  assert.equal((await Quota.findById(user._id)).slots.length, 3);
  assert.equal(await MemoryPhoto.countDocuments(), 3);
});

test("failed quota release recovers from durable database state in a new server process", async () => {
  const upload = storage.uploadImage;
  const update = Quota.updateOne;
  storage.uploadImage = async () => { throw new Error("Storage failure"); };
  Quota.updateOne = async () => { throw new Error("Release unavailable"); };
  try {
    assert.equal((await submit()).status, 503);
    assert.equal((await Quota.findById(user._id)).slots.length, 1);
  } finally { storage.uploadImage = upload; Quota.updateOne = update; }
  // Stop the server, then reconcile in a fresh process with no request memory.
  await new Promise((resolve) => server.close(resolve));
  const recovery = spawn(process.execPath, ["-e", `
    const mongoose = require('mongoose');
    const quota = require('./utils/memoryPhotoQuota');
    (async () => {
      await mongoose.connect(process.argv[1]);
      try { await quota.recoverCancelled(process.argv[2]); }
      finally { await mongoose.disconnect(); }
    })().catch(() => { process.exitCode = 1; });
  `, mongoose.connection.client.s.url, String(user._id)], {
    cwd: path.resolve(__dirname, ".."), stdio: "ignore",
  });
  assert.equal(await new Promise((resolve, reject) => {
    recovery.once("error", reject);
    recovery.once("exit", resolve);
  }), 0);
  assert.equal((await Quota.findById(user._id)).slots.length, 0);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (let index = 0; index < 3; index++) assert.equal((await submit()).status, 201);
});

test("unacknowledged cancellation cannot release quota or delete private bytes", async () => {
  const save = MemoryPhoto.prototype.save;
  const update = MemoryPhoto.collection.updateOne;
  MemoryPhoto.prototype.save = async () => { throw new Error("Insert uncertain"); };
  MemoryPhoto.collection.updateOne = async () => ({ acknowledged: false });
  try {
    assert.equal((await submit()).status, 503);
    assert.equal((await Quota.findById(user._id)).slots.length, 1);
    assert.equal((await files()).length, 1);
  } finally { MemoryPhoto.prototype.save = save; MemoryPhoto.collection.updateOne = update; }
});

test("multiple workers can recover the same cancellation without freeing accepted slots", async () => {
  assert.equal((await submit()).status, 201);
  const failed = new mongoose.Types.ObjectId();
  await quota.reserve(user._id, failed);
  await quota.cancel(user._id, failed);
  await Promise.all(Array.from({ length: 8 }, () => quota.recoverCancelled(user._id)));
  assert.equal((await Quota.findById(user._id)).slots.length, 1);
  const responses = await Promise.all(Array.from({ length: 8 }, () => submit()));
  assert.equal(responses.filter(({ status }) => status === 201).length, 2);
  assert.equal(responses.filter(({ status }) => status === 409).length, 6);
  assert.equal(await MemoryPhoto.countDocuments(), 3);
});

test("recovery never releases accepted or unresolved reservations, even if old", async () => {
  const accepted = await submit();
  assert.equal(accepted.status, 201);
  const unresolved = new mongoose.Types.ObjectId();
  await quota.reserve(user._id, unresolved);
  await quota.recoverCancelled(user._id);
  assert.equal((await Quota.findById(user._id)).slots.length, 2);
  assert.equal((await submit()).status, 201);
  assert.equal((await submit()).status, 409);
  // Explicit resolution of this failed operation fences it before restoring space.
  await quota.release(user._id, unresolved);
  assert.equal((await submit()).status, 201);
  assert.equal(await MemoryPhoto.countDocuments(), 3);
});

test("an uncertain reservation write cannot leave an unfenced late photo insert", async () => {
  const reserve = quota.reserve;
  let delayedId;
  quota.reserve = async (owner, photoId) => {
    delayedId = photoId;
    await reserve(owner, photoId);
    throw new Error("Reservation acknowledgement lost");
  };
  try { assert.equal((await submit()).status, 503); }
  finally { quota.reserve = reserve; }
  await assert.rejects(MemoryPhoto.collection.insertOne({
    _id: delayedId, owner: user._id, imageKey: "private/late.png", status: "PENDING",
  }), { code: 11000 });
  assert.equal((await Quota.findById(user._id)).slots.length, 0);
  for (let index = 0; index < 3; index++) assert.equal((await submit()).status, 201);
});
