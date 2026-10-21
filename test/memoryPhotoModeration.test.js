const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const sharp = require("sharp");

const directory = require("node:fs").mkdtempSync(path.join(os.tmpdir(), "memory-photo-moderation-"));
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.LOCAL_UPLOAD_DIR = path.join(directory, "public");
process.env.MEMORY_PHOTO_UPLOAD_DIR = path.join(directory, "private");
const app = require("../app");
const User = require("../model/usersModel");
const Admin = require("../model/adminsModel");
const Election = require("../model/electionModel");
const MemoryPhoto = require("../model/memoryPhotosModel");
const Quota = require("../model/memoryPhotoQuotasModel");
const storage = require("../utils/memoryPhotoStorage");
let mongo;
let mongoExit;
let server;
let base;
let owner;
let admin;
let otherAdmin;
let adminToken;
let otherToken;
let userToken;
let png;

const signAdmin = (account) => jwt.sign({ adminId: account._id.toString(), role: "admin" }, process.env.JWT_SECRET);
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
    "--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", databasePath,
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
  } finally { await client.close(); }
  await mongoose.connect(`mongodb://127.0.0.1:${port}/memory_photo_moderation_test`);
  await Promise.all([User.init(), Admin.init(), Election.init(), MemoryPhoto.init(), Quota.init()]);
  png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "blue" } }).png().toBuffer();
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 30000 });

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Admin.deleteMany({}), Election.deleteMany({}), MemoryPhoto.deleteMany({}), Quota.deleteMany({})]);
  await fs.rm(process.env.MEMORY_PHOTO_UPLOAD_DIR, { recursive: true, force: true });
  owner = await User.create({ email: "student@example.com", passwordHash: "test-only-hash" });
  [admin, otherAdmin] = await Admin.create([
    { username: "reviewer-one", passwordHash: "test-only-hash" },
    { username: "reviewer-two", passwordHash: "test-only-hash" },
  ]);
  adminToken = signAdmin(admin);
  otherToken = signAdmin(otherAdmin);
  userToken = jwt.sign({ userId: owner._id.toString(), role: "user" }, process.env.JWT_SECRET);
  await Election.create({ registrationClosesAt: new Date("2026-11-06"), votingOpensAt: new Date("2026-10-28"),
    votingClosesAt: new Date("2026-11-02"), resultsPublishedAt: new Date("2026-11-03"), memoryPhotosEnabled: false });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo?.pid && mongo.exitCode === null) { mongo.kill("SIGTERM"); await mongoExit; }
  await fs.rm(directory, { recursive: true, force: true });
});

const request = async (method, endpoint, body, token = adminToken) => {
  const response = await fetch(`${base}/api/v1${endpoint}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};
const photo = async (overrides = {}) => MemoryPhoto.create({ owner: owner._id,
  imageKey: await storage.uploadImage({ buffer: png, mimetype: "image/png" }), ...overrides });
const imageUrl = (id) => `${base}/api/v1/admin/memory-photos/${id}/image`;
const imageRequest = (id, token = adminToken) => fetch(imageUrl(id), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const review = (id, status, token = adminToken) => request("PATCH", `/admin/memory-photos/${id}/review`, { status }, token);

test("pending queue is newest first, excludes reviewed photos and never reveals storage keys", async () => {
  const oldest = await photo({ createdAt: new Date("2026-01-01") });
  await photo({ status: "APPROVED" });
  await photo({ status: "REJECTED" });
  const newest = await photo({ createdAt: new Date("2026-01-03") });
  const middle = await photo({ createdAt: new Date("2026-01-02") });
  const response = await request("GET", "/admin/memory-photos?status=REJECTED");
  assert.equal(response.status, 200);
  assert.equal(response.body.results, 3);
  assert.deepEqual(response.body.data.photos.map((entry) => entry.id), [newest, middle, oldest].map((entry) => String(entry._id)));
  for (const entry of response.body.data.photos) {
    assert.equal(entry.status, "PENDING");
    assert.deepEqual(Object.keys(entry).sort(), ["createdAt", "id", "owner", "status"]);
  }
  assert(!JSON.stringify(response.body).includes("memory-photos/"));
  await MemoryPhoto.updateMany({}, { status: "APPROVED" });
  const empty = await request("GET", "/admin/memory-photos");
  assert.equal(empty.body.results, 0);
  assert.deepEqual(empty.body.data.photos, []);
});

test("admins retrieve private images with no-store and nosniff even while the feature is disabled", async () => {
  for (const status of ["PENDING", "REJECTED", "APPROVED"]) {
    const saved = await photo({ status });
    const response = await imageRequest(saved._id);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^image\/png/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("vary"), /Authorization/);
    assert.equal(response.headers.get("location"), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.equal((await fetch(`${base}/uploads/${saved.imageKey}`)).status, 404);
  }
});

test("production-style private streams are delivered without issuing URLs", async () => {
  const saved = await photo();
  const original = storage.getImage;
  storage.getImage = async (key) => {
    assert.equal(key, saved.imageKey);
    return { body: Readable.from([png.subarray(0, 8), png.subarray(8)]), contentType: "image/png", contentLength: png.length };
  };
  try {
    const response = await imageRequest(saved._id);
    assert.equal(response.status, 200);
    assert.equal(Number(response.headers.get("content-length")), png.length);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  } finally { storage.getImage = original; }
});

test("all moderation operations reject anonymous, invalid, expired, ordinary and disabled admin tokens", async () => {
  const saved = await photo();
  const expired = jwt.sign({ adminId: String(admin._id), role: "admin" }, process.env.JWT_SECRET, { expiresIn: -1 });
  const operations = [
    (token) => request("GET", "/admin/memory-photos", undefined, token),
    (token) => request("GET", `/admin/memory-photos/${saved._id}/image`, undefined, token),
    (token) => review(saved._id, "APPROVED", token),
  ];
  for (const operation of operations) {
    for (const [token, status] of [[null, 401], ["invalid", 401], [expired, 401], [userToken, 403]]) {
      assert.equal((await operation(token)).status, status);
    }
  }
  await Admin.updateOne({ _id: admin._id }, { status: "disabled" });
  for (const operation of operations) assert.equal((await operation(adminToken)).status, 403);
  await Admin.deleteOne({ _id: admin._id });
  for (const operation of operations) assert.equal((await operation(adminToken)).status, 401);
  assert.equal((await MemoryPhoto.findById(saved._id)).status, "PENDING");
});

test("ordinary students cannot retrieve pending or rejected image content through any exposed route", async () => {
  for (const status of ["PENDING", "REJECTED"]) {
    const saved = await photo({ status });
    for (const token of [null, userToken]) {
      const denied = await imageRequest(saved._id, token);
      assert.equal(denied.status, token ? 403 : 401);
      assert(!JSON.stringify(await denied.json()).includes(saved.imageKey));
      const publicResponse = await fetch(`${base}/api/v1/memory-photos/${saved._id}/image`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      // Public routes are gated while the feature is disabled for this test.
      assert.equal(publicResponse.status, 403);
    }
  }
});

test("invalid IDs, statuses, extra fields and missing photos are rejected without review metadata", async () => {
  const saved = await photo();
  for (const id of ["invalid", "123456789012", "zzzzzzzzzzzzzzzzzzzzzzzz"]) {
    assert.equal((await review(id, "APPROVED")).status, 400);
    assert.equal((await imageRequest(id)).status, 400);
  }
  for (const body of [{}, { status: "PENDING" }, { status: "approved" }, { status: "UNKNOWN" },
    { status: null }, { status: true }, { status: ["APPROVED"] },
    { status: "APPROVED", reviewedBy: String(otherAdmin._id) },
    { status: "REJECTED", reviewedAt: "2026-01-01" }, { status: "APPROVED", imageKey: "fake" }]) {
    assert.equal((await request("PATCH", `/admin/memory-photos/${saved._id}/review`, body)).status, 400);
  }
  const missing = new mongoose.Types.ObjectId();
  assert.equal((await review(missing, "APPROVED")).status, 404);
  assert.equal((await imageRequest(missing)).status, 404);
  const untouched = await MemoryPhoto.findById(saved._id);
  assert.equal(untouched.status, "PENDING");
  assert.equal(untouched.reviewedBy, undefined);
  assert.equal(untouched.reviewedAt, undefined);
});

test("approval and rejection save the authenticated reviewer and server timestamp exactly once", async () => {
  for (const status of ["APPROVED", "REJECTED"]) {
    const saved = await photo();
    const before = Date.now();
    const response = await review(saved._id, status);
    const after = Date.now();
    assert.equal(response.status, 200);
    const reviewed = response.body.data.photo;
    assert.equal(reviewed.status, status);
    assert.equal(reviewed.reviewedBy, String(admin._id));
    assert(Date.parse(reviewed.reviewedAt) >= before && Date.parse(reviewed.reviewedAt) <= after);
    assert.equal(reviewed.imageKey, undefined);
    const loaded = await MemoryPhoto.findById(saved._id);
    assert.equal(loaded.imageKey, saved.imageKey);
    assert.equal(String(loaded.owner), String(owner._id));
    assert.equal(+loaded.createdAt, +saved.createdAt);
    assert.equal(String(loaded.reviewedBy), reviewed.reviewedBy);
    assert.equal(loaded.reviewedAt.toISOString(), reviewed.reviewedAt);
    for (const nextStatus of ["APPROVED", "REJECTED"]) {
      assert.equal((await review(saved._id, nextStatus, otherToken)).status, 409);
    }
    const unchanged = await MemoryPhoto.findById(saved._id);
    assert.equal(String(unchanged.reviewedBy), reviewed.reviewedBy);
    assert.equal(unchanged.reviewedAt.toISOString(), reviewed.reviewedAt);
    assert.equal(unchanged.status, status);
  }
  assert.equal((await request("GET", "/admin/memory-photos")).body.results, 0);
});

test("simultaneous conflicting reviews have one atomic winner and preserve its full decision", async () => {
  const saved = await photo();
  const responses = await Promise.all(Array.from({ length: 10 }, (_, index) =>
    review(saved._id, index % 2 ? "APPROVED" : "REJECTED", index % 2 ? adminToken : otherToken)));
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(responses.filter((response) => response.status === 409).length, 9);
  const winner = responses.find((response) => response.status === 200).body.data.photo;
  const loaded = await MemoryPhoto.findById(saved._id);
  assert.equal(loaded.status, winner.status);
  assert.equal(String(loaded.reviewedBy), winner.reviewedBy);
  assert.equal(loaded.reviewedAt.toISOString(), winner.reviewedAt);
  assert.equal(winner.reviewedBy, String(winner.status === "APPROVED" ? admin._id : otherAdmin._id));
});

test("reviewing three real submissions while disabled leaves rejected photos counted in lifetime quota", async () => {
  await Election.updateOne({}, { memoryPhotosEnabled: true });
  const ids = [];
  for (let index = 0; index < 3; index++) {
    const form = new FormData();
    form.append("images", new Blob([png], { type: "image/png" }), "student.png");
    const response = await fetch(`${base}/api/v1/memory-photos`, { method: "POST",
      headers: { Authorization: `Bearer ${userToken}` }, body: form });
    assert.equal(response.status, 201);
    ids.push((await response.json()).data.photo.id);
  }
  const before = await Quota.findById(owner._id).lean();
  await Election.updateOne({}, { memoryPhotosEnabled: false });
  assert.equal((await request("GET", "/admin/memory-photos")).body.results, 3);
  for (const id of ids) assert.equal((await review(id, "REJECTED")).status, 200);
  assert.deepEqual(await Quota.findById(owner._id).lean(), before);
  assert.equal(await MemoryPhoto.countDocuments({ owner: owner._id, status: "REJECTED" }), 3);
  await Election.updateOne({}, { memoryPhotosEnabled: true });
  const form = new FormData();
  form.append("images", new Blob([png], { type: "image/png" }), "extra.png");
  assert.equal((await fetch(`${base}/api/v1/memory-photos`, { method: "POST",
    headers: { Authorization: `Bearer ${userToken}` }, body: form })).status, 409);
});

test("missing private objects return 404 and storage failures do not disclose private details", async () => {
  const saved = await photo();
  await storage.deleteImage(saved.imageKey);
  assert.equal((await imageRequest(saved._id)).status, 404);
  const original = storage.getImage;
  storage.getImage = async () => { throw new Error(`private details: ${saved.imageKey}`); };
  try {
    const response = await imageRequest(saved._id);
    assert.equal(response.status, 503);
    assert(!JSON.stringify(await response.json()).includes(saved.imageKey));
  } finally { storage.getImage = original; }
});

test("private stream errors close delivery without leaking provider errors or hanging", async () => {
  const saved = await photo();
  const original = storage.getImage;
  storage.getImage = async () => ({
    body: Readable.from((async function* () {
      yield png.subarray(0, 8);
      await new Promise((resolve) => setTimeout(resolve, 15));
      throw new Error(`private provider details: ${saved.imageKey}`);
    })()), contentType: "image/png", contentLength: png.length,
  });
  try {
    const response = await imageRequest(saved._id);
    assert.equal(response.status, 200);
    await assert.rejects(response.arrayBuffer());
  } finally { storage.getImage = original; }
});
