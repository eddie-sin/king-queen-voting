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

const directory = require("node:fs").mkdtempSync(path.join(os.tmpdir(), "memory-photo-public-gallery-"));
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.LOCAL_UPLOAD_DIR = path.join(directory, "public");
process.env.MEMORY_PHOTO_UPLOAD_DIR = path.join(directory, "private");
const app = require("../app");
const User = require("../model/usersModel");
const Admin = require("../model/adminsModel");
const Controls = require("../model/eventControlsModel");
const { createUser, studentToken, headers: authHeaders } = require("./helpers/accounts.cjs");
const MemoryPhoto = require("../model/memoryPhotosModel");
const storage = require("../utils/memoryPhotoStorage");
const publicStorage = require("../utils/imageStorage");
const Image = require("../model/imagesModel");
let mongo;
let mongoExit;
let server;
let base;
let owner;
let admin;
let adminToken;
let userToken;
let png;

before(async () => {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const databasePath = path.join(directory, "mongo");
  await fs.mkdir(databasePath);
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
  await mongoose.connect(`mongodb://127.0.0.1:${port}/memory_photo_public_gallery_test`);
  await Promise.all([...Object.values(mongoose.models).map(model => model.init()), Admin.init(), Controls.init(), MemoryPhoto.init(), Image.init()]);
  png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "green" } }).png().toBuffer();
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 30000 });

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Admin.deleteMany({}), Controls.deleteMany({}), MemoryPhoto.deleteMany({}), Image.deleteMany({})]);
  await fs.rm(process.env.MEMORY_PHOTO_UPLOAD_DIR, { recursive: true, force: true });
  owner = await createUser({ email: "student@gmail.com", passwordHash: "test-only-hash" });
  admin = await Admin.create({ username: "reviewer", role: "admin", passwordHash: "test-only-hash" });
  adminToken = jwt.sign({ adminId: String(admin._id), role: "admin", v: 0 }, process.env.JWT_SECRET);
  userToken = await studentToken(owner);
  await Controls.create({ _id: "event", memoryPhotosEnabled: true });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo?.pid && mongo.exitCode === null) { mongo.kill("SIGTERM"); await mongoExit; }
  await fs.rm(directory, { recursive: true, force: true });
});

const url = (suffix = "") => `${base}/api/v1/memory-photos${suffix}`;
const photo = async (overrides = {}) => MemoryPhoto.create({
  owner: owner._id, status: "APPROVED", reviewedBy: admin._id, reviewedAt: new Date(),
  imageKey: await storage.uploadImage({ buffer: png, mimetype: "image/png" }), ...overrides,
});
const list = async (query = "", options) => {
  const response = await fetch(url(query), options);
  return { status: response.status, headers: response.headers, body: await response.json() };
};

test("anonymous listing includes only APPROVED metadata, newest first, without private details", async () => {
  const older = await photo({ createdAt: new Date("2026-01-01") });
  const newer = await photo({ createdAt: new Date("2026-01-02") });
  await photo({ status: "PENDING" });
  await photo({ status: "REJECTED" });
  const response = await list();
  assert.equal(response.status, 200);
  assert.equal(response.body.results, 2);
  assert.deepEqual(response.body.data.photos.map((item) => item.id), [String(newer._id), String(older._id)]);
  for (const item of response.body.data.photos) {
    assert.deepEqual(Object.keys(item).sort(), ["createdAt", "id", "likeCount"]);
    assert.equal(item.likeCount, 0);
  }
  assert(!JSON.stringify(response.body).includes("memory-photos/"));
  assert.deepEqual(response.body.pagination, { page: 1, limit: 20, hasMore: false });
});

test("false, missing and absent feature settings deny both public endpoints without storage access", async () => {
  const saved = await photo();
  const original = storage.getImage;
  storage.getImage = async () => { throw new Error("Disabled requests must not read storage"); };
  try {
    for (const change of [
      () => Controls.updateOne({}, { memoryPhotosEnabled: false }),
      () => Controls.collection.updateOne({}, { $set: { memoryPhotosEnabled: "true" } }),
      () => Controls.collection.updateOne({}, { $unset: { memoryPhotosEnabled: "" } }),
      () => Controls.deleteMany({}),
    ]) {
      await change();
      assert.equal((await list()).status, 403);
      const response = await fetch(url(`/${saved._id}/image`));
      assert.equal(response.status, 403);
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
  } finally { storage.getImage = original; }
});

test("anonymous approved image delivery has correct types and no reusable caching validators", async () => {
  for (const [format, type] of [["png", "image/png"], ["jpeg", "image/jpeg"], ["webp", "image/webp"]]) {
    const bytes = await sharp(png).toFormat(format).toBuffer();
    const key = await storage.uploadImage({ buffer: bytes, mimetype: type });
    const saved = await photo({ imageKey: key });
    const response = await fetch(url(`/${saved._id}/image`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), type);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.equal(response.headers.get("expires"), "0");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("etag"), null);
    assert.equal(response.headers.get("last-modified"), null);
    assert.equal(response.headers.get("location"), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal((await fetch(`${base}/uploads/${key}`)).status, 404);
  }
});

test("pending and rejected images stay private for anonymous and ordinary authenticated users", async () => {
  const original = storage.getImage;
  let reads = 0;
  storage.getImage = async (...args) => { reads++; return original(...args); };
  try {
    for (const status of ["PENDING", "REJECTED"]) {
      const saved = await photo({ status });
      for (const token of [null, userToken, adminToken]) {
        const response = await fetch(url(`/${saved._id}/image`), {
          headers: authHeaders(token),
        });
        assert.equal(response.status, 404);
        assert(!JSON.stringify(await response.json()).includes(saved.imageKey));
      }
    }
    assert.equal(reads, 0);
    assert.equal((await list()).body.results, 0);
  } finally { storage.getImage = original; }
});

test("pagination is bounded, deterministic for equal timestamps and rejects invalid parameters", async () => {
  const entries = await MemoryPhoto.create(Array.from({ length: 55 }, () => ({
    owner: owner._id, imageKey: "private/not-read-by-list.png", status: "APPROVED", createdAt: new Date("2026-01-01"),
  })));
  const expected = entries.map((entry) => String(entry._id)).sort().reverse();
  const first = await list("?page=1&limit=50");
  assert.equal(first.body.results, 50);
  assert.equal(first.body.pagination.hasMore, true);
  assert.deepEqual(first.body.data.photos.map((entry) => entry.id), expected.slice(0, 50));
  const second = await list("?page=2&limit=50");
  assert.equal(second.body.results, 5);
  assert.equal(second.body.pagination.hasMore, false);
  assert.deepEqual(second.body.data.photos.map((entry) => entry.id), expected.slice(50));
  assert.equal((await list()).body.results, 20);
  assert.deepEqual((await list("?page=1000&limit=50")).body.data.photos, []);
  for (const query of ["?page=0", "?page=-1", "?page=1.2", "?page=1001", "?page=1e2", "?page=",
    "?limit=0", "?limit=51", "?limit=-1", "?limit=2.5", "?limit=abc", "?limit=", "?page=1&page=2",
    "?limit=1&limit=2", "?status=PENDING", "?owner=arbitrary", "?limit=9999999999999999999999"]) {
    assert.equal((await list(query)).status, 400, query);
  }
});

test("invalid IDs and missing records or files return safe errors", async () => {
  for (const id of ["invalid", "123456789012", "zzzzzzzzzzzzzzzzzzzzzzzz"]) {
    assert.equal((await fetch(url(`/${id}/image`))).status, 400);
  }
  assert.equal((await fetch(url(`/${new mongoose.Types.ObjectId()}/image`))).status, 404);
  const saved = await photo();
  await storage.deleteImage(saved.imageKey);
  assert.equal((await fetch(url(`/${saved._id}/image`))).status, 404);
  const original = storage.getImage;
  storage.getImage = async () => { throw new Error(`private provider details: ${saved.imageKey}`); };
  try {
    const response = await fetch(url(`/${saved._id}/image`));
    assert.equal(response.status, 503);
    assert(!JSON.stringify(await response.json()).includes(saved.imageKey));
  } finally { storage.getImage = original; }
});

test("disabling blocks conditional and range requests for previously delivered images", async () => {
  const saved = await photo();
  const path = url(`/${saved._id}/image`);
  const headers = { "If-None-Match": "*", "If-Modified-Since": new Date("2099-01-01").toUTCString(), Range: "bytes=0-7" };
  const enabled = await fetch(path, { headers });
  assert.equal(enabled.status, 200);
  assert.deepEqual(Buffer.from(await enabled.arrayBuffer()), png);
  const changed = await fetch(`${base}/api/v1/admin/controls/memory.close`, {
    method: "POST", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ revision: (await Controls.findById("event")).revision, operationId: crypto.randomUUID() }),
  });
  assert.equal(changed.status, 200);
  const disabled = await fetch(path, { headers });
  assert.equal(disabled.status, 403);
  assert.match(disabled.headers.get("cache-control"), /no-store/);
  assert.equal((await list("", { headers })).status, 403);
});

test("feature or approval changes during private storage retrieval prevent byte delivery", async () => {
  const saved = await photo();
  const original = storage.getImage;
  let stream;
  try {
    for (const change of [
      () => Controls.updateOne({}, { memoryPhotosEnabled: false }),
      () => MemoryPhoto.updateOne({ _id: saved._id }, { status: "REJECTED" }),
    ]) {
      await Controls.updateOne({}, { memoryPhotosEnabled: true });
      await MemoryPhoto.updateOne({ _id: saved._id }, { status: "APPROVED" });
      storage.getImage = async () => {
        await change();
        stream = Readable.from([png]);
        return { body: stream, contentType: "image/png", contentLength: png.length };
      };
      const response = await fetch(url(`/${saved._id}/image`));
      assert([403, 404].includes(response.status));
      assert.equal(stream.destroyed, true);
    }
  } finally { storage.getImage = original; }
});

test("private S3-style streams deliver approved bytes, and stream failures terminate safely", async () => {
  const saved = await photo();
  const original = storage.getImage;
  try {
    storage.getImage = async () => ({ body: Readable.from([png]), contentType: "image/png", contentLength: png.length });
    const response = await fetch(url(`/${saved._id}/image`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("etag"), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    storage.getImage = async () => ({
      body: Readable.from((async function* () {
        yield png.subarray(0, 8);
        await new Promise((resolve) => setTimeout(resolve, 15));
        throw new Error("Private provider stream error");
      })()), contentType: "image/png", contentLength: png.length,
    });
    const interrupted = await fetch(url(`/${saved._id}/image`));
    assert.equal(interrupted.status, 200);
    await assert.rejects(interrupted.arrayBuffer());
  } finally { storage.getImage = original; }
});

test("admin moderation stays available while disabled and the old public gallery remains separate", async () => {
  const pending = await photo({ status: "PENDING" });
  const publicUrl = await publicStorage.uploadImage({ buffer: png, mimetype: "image/png" }, "gallery/memory");
  await Image.create({ section: "memory", url: publicUrl });
  await Controls.updateOne({}, { memoryPhotosEnabled: false });
  const headers = { Authorization: `Bearer ${adminToken}` };
  const queue = await fetch(`${base}/api/v1/admin/memory-photos`, { headers });
  assert.equal(queue.status, 200);
  assert.equal((await queue.json()).results, 1);
  const privateImage = await fetch(`${base}/api/v1/admin/memory-photos/${pending._id}/image`, { headers });
  assert.equal(privateImage.status, 200);
  await privateImage.arrayBuffer();
  const approved = await fetch(`${base}/api/v1/admin/memory-photos/${pending._id}/review`, {
    method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ status: "APPROVED" }),
  });
  assert.equal(approved.status, 200);
  assert.equal((await fetch(url(`/${pending._id}/image`))).status, 403);
  const oldGallery = await fetch(`${base}/api/v1/images?section=memory`);
  assert.equal(oldGallery.status, 200);
  assert.equal((await oldGallery.json()).results, 1);
  assert.deepEqual(Buffer.from(await (await fetch(`${base}${publicUrl}`)).arrayBuffer()), png);
  await Controls.updateOne({}, { memoryPhotosEnabled: true });
  assert.equal((await list()).body.results, 1);
});
