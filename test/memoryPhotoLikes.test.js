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

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
const app = require("../app");
const User = require("../model/usersModel");
const Election = require("../model/electionModel");
const MemoryPhoto = require("../model/memoryPhotosModel");
const Like = require("../model/memoryPhotoLikesModel");
const Quota = require("../model/memoryPhotoQuotasModel");
let mongo;
let mongoExit;
let directory;
let server;
let base;
let user;
let other;
let token;
let otherToken;
let photo;

const sign = (account) => jwt.sign({ userId: String(account._id), role: "user" }, process.env.JWT_SECRET);
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "memory-photo-likes-"));
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  mongo = spawn(process.env.MONGOD_BINARY || "mongod", [
    "--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", directory,
    "--logpath", path.join(directory, "mongod.log"),
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
  await mongoose.connect(`mongodb://127.0.0.1:${port}/memory_photo_likes_test`);
  await Promise.all([User.init(), Election.init(), MemoryPhoto.init(), Like.init(), Quota.init()]);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1/memory-photos`;
}, { timeout: 30000 });

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Election.deleteMany({}), MemoryPhoto.deleteMany({}), Like.deleteMany({}), Quota.deleteMany({})]);
  [user, other] = await User.create([
    { email: "one@example.com", passwordHash: "test-only-hash" },
    { email: "two@example.com", passwordHash: "test-only-hash" },
  ]);
  token = sign(user);
  otherToken = sign(other);
  photo = await MemoryPhoto.create({ owner: user._id, imageKey: "private/not-read-for-likes.png", status: "APPROVED" });
  await Election.create({ registrationClosesAt: new Date("2026-11-06"), votingOpensAt: new Date("2026-10-28"),
    votingClosesAt: new Date("2026-11-02"), resultsPublishedAt: new Date("2026-11-03"), memoryPhotosEnabled: true });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo?.pid && mongo.exitCode === null) { mongo.kill("SIGTERM"); await mongoExit; }
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

const mutate = async (method = "POST", { auth = token, id = photo._id, body, query = "" } = {}) => {
  const response = await fetch(`${base}/${id}/like${query}`, {
    method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};
const gallery = async (query = "") => {
  const response = await fetch(`${base}${query}`);
  assert.equal(response.status, 200);
  return response.json();
};

test("likes and unlikes are idempotent and use only the authenticated user's identity", async () => {
  const first = await mutate();
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.data, { photoId: String(photo._id), liked: true, likeCount: 1 });
  const stored = await Like.findOne().lean();
  assert.equal(String(stored.userId), String(user._id));
  assert(stored.createdAt instanceof Date);
  for (let index = 0; index < 3; index++) assert.deepEqual(await mutate(), first);
  assert.deepEqual(await Like.findOne().lean(), stored);
  assert.equal((await mutate("POST", { auth: otherToken })).body.data.likeCount, 2);
  const removed = await mutate("DELETE");
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.data, { photoId: String(photo._id), liked: false, likeCount: 1 });
  assert.deepEqual(await mutate("DELETE"), removed);
  assert.equal(await Like.countDocuments({ userId: other._id }), 1);
  assert.equal((await mutate()).body.data.likeCount, 2);
});

test("anonymous, invalid, expired, admin, disabled and deleted users cannot mutate likes", async () => {
  const adminToken = jwt.sign({ adminId: String(new mongoose.Types.ObjectId()), role: "admin" }, process.env.JWT_SECRET);
  const expired = jwt.sign({ userId: String(user._id), role: "user" }, process.env.JWT_SECRET, { expiresIn: -1 });
  for (const method of ["POST", "DELETE"]) {
    for (const [auth, status] of [[null, 401], ["invalid", 401], [expired, 401], [adminToken, 403]]) {
      assert.equal((await mutate(method, { auth })).status, status);
    }
  }
  await User.updateOne({ _id: user._id }, { status: "disabled" });
  for (const method of ["POST", "DELETE"]) assert.equal((await mutate(method)).status, 403);
  await User.deleteOne({ _id: user._id });
  for (const method of ["POST", "DELETE"]) assert.equal((await mutate(method)).status, 401);
  assert.equal(await Like.countDocuments(), 0);
});

test("disabled and missing feature configuration prevents changes and preserves existing likes", async () => {
  await mutate();
  for (const change of [
    () => Election.updateOne({}, { memoryPhotosEnabled: false }),
    () => Election.collection.updateOne({}, { $unset: { memoryPhotosEnabled: "" } }),
    () => Election.deleteMany({}),
  ]) {
    await change();
    for (const method of ["POST", "DELETE"]) assert.equal((await mutate(method)).status, 403);
    assert.equal(await Like.countDocuments(), 1);
  }
});

test("only APPROVED photos can be liked or unliked and invalid IDs are rejected", async () => {
  await mutate();
  for (const status of ["PENDING", "REJECTED"]) {
    await MemoryPhoto.updateOne({ _id: photo._id }, { status });
    for (const method of ["POST", "DELETE"]) assert.equal((await mutate(method)).status, 404);
  }
  for (const method of ["POST", "DELETE"]) {
    for (const id of ["invalid", "123456789012", "zzzzzzzzzzzzzzzzzzzzzzzz"]) {
      assert.equal((await mutate(method, { id })).status, 400);
    }
    assert.equal((await mutate(method, { id: new mongoose.Types.ObjectId() })).status, 404);
  }
  assert.equal(await Like.countDocuments(), 1);
});

test("client-supplied user IDs and other fields cannot target another student's like", async () => {
  await mutate("POST", { auth: otherToken });
  for (const method of ["POST", "DELETE"]) {
    assert.equal((await mutate(method, { body: { userId: String(other._id) } })).status, 400);
    assert.equal((await mutate(method, { body: { photoId: String(photo._id) } })).status, 400);
    assert.equal((await mutate(method, { query: `?userId=${other._id}` })).status, 400);
  }
  assert.equal(await Like.countDocuments({ userId: other._id }), 1);
  assert.equal(await Like.countDocuments({ userId: user._id }), 0);
});

test("twenty concurrent duplicate likes create exactly one record; concurrent unlikes remove it once", async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => mutate()));
  assert(results.every((result) => result.status === 200 && result.body.data.liked === true));
  assert.equal(await Like.countDocuments(), 1);
  assert.equal((await gallery()).data.photos[0].likeCount, 1);
  const removed = await Promise.all(Array.from({ length: 20 }, () => mutate("DELETE")));
  assert(removed.every((result) => result.status === 200 && result.body.data.liked === false));
  assert.equal(await Like.countDocuments(), 0);
  assert.equal((await gallery()).data.photos[0].likeCount, 0);
});

test("overlapping likes/unlikes leave no duplicates and public counts match settled database state", async () => {
  const responses = await Promise.all(Array.from({ length: 24 }, (_, index) =>
    mutate(index % 2 ? "POST" : "DELETE", { auth: index % 3 ? token : otherToken })));
  assert(responses.every((response) => response.status === 200));
  for (const account of [user, other]) assert(await Like.countDocuments({ photoId: photo._id, userId: account._id }) <= 1);
  const count = await Like.countDocuments({ photoId: photo._id });
  assert.equal((await gallery()).data.photos[0].likeCount, count);
});

test("gallery counts are accurate across bounded pages, include zero and never reveal likers", async () => {
  await MemoryPhoto.updateOne({ _id: photo._id }, { createdAt: new Date("2026-01-03") });
  const zero = await MemoryPhoto.create({ owner: user._id, imageKey: "private/zero", status: "APPROVED", createdAt: new Date("2026-01-02") });
  const third = await MemoryPhoto.create({ owner: user._id, imageKey: "private/third", status: "APPROVED", createdAt: new Date("2026-01-01") });
  const hidden = await MemoryPhoto.create({ owner: user._id, imageKey: "private/hidden", status: "PENDING" });
  await Like.create([
    { photoId: photo._id, userId: user._id }, { photoId: photo._id, userId: other._id },
    { photoId: third._id, userId: user._id }, { photoId: hidden._id, userId: other._id },
  ]);
  const first = await gallery("?limit=2");
  assert.deepEqual(first.data.photos.map((entry) => [entry.id, entry.likeCount]), [[String(photo._id), 2], [String(zero._id), 0]]);
  assert.equal(first.pagination.hasMore, true);
  const second = await gallery("?page=2&limit=2");
  assert.deepEqual(second.data.photos.map((entry) => [entry.id, entry.likeCount]), [[String(third._id), 1]]);
  for (const entry of [...first.data.photos, ...second.data.photos]) {
    assert.deepEqual(Object.keys(entry).sort(), ["createdAt", "id", "likeCount"]);
  }
  assert(!JSON.stringify(first).includes(String(user._id)));
  assert(!JSON.stringify(first).includes(String(other._id)));
});

test("like operations never change quota, photo moderation or image references", async () => {
  await Quota.create({ _id: user._id, slots: [photo._id] });
  const beforePhoto = await MemoryPhoto.findById(photo._id).lean();
  const beforeQuota = await Quota.findById(user._id).lean();
  await mutate();
  await mutate("DELETE");
  assert.deepEqual(await MemoryPhoto.findById(photo._id).lean(), beforePhoto);
  assert.deepEqual(await Quota.findById(user._id).lean(), beforeQuota);
});
const likeStatus = async ({ auth = token, query = `photoIds=${photo._id}`, body, contentType = "application/json" } = {}) => {
  // Node fetch forbids GET bodies, so use HTTP directly to test the server boundary.
  const http = require("node:http");
  const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(`${base}/like-status${query ? `?${query}` : ""}`, {
      method: "GET", headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        ...(data === undefined ? {} : { "Content-Type": contentType, "Content-Length": Buffer.byteLength(data) }) },
    }, response => {
      let text = ""; response.setEncoding("utf8"); response.on("data", chunk => text += chunk);
      response.on("end", () => { try { resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(text) }); } catch (error) { reject(error); } });
    });
    request.on("error", reject); request.end(data);
  });
};

test("like-status isolates students, returns true/false in requested order and is read-only", async () => {
  const second = await MemoryPhoto.create({ owner: other._id, imageKey: "private/second", status: "APPROVED" });
  await Like.create([{ photoId: photo._id, userId: user._id }, { photoId: second._id, userId: other._id }]);
  const before = await Like.find().sort({ _id: 1 }).lean();
  const query = `photoIds=${second._id},${String(photo._id).toUpperCase()}`;
  const first = await likeStatus({ query });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { status: "success", results: 2, data: { photos: [
    { photoId: String(second._id), liked: false }, { photoId: String(photo._id), liked: true },
  ] } });
  assert.deepEqual((await likeStatus({ query, auth: otherToken })).body.data.photos, [
    { photoId: String(second._id), liked: true }, { photoId: String(photo._id), liked: false },
  ]);
  assert.deepEqual(await Like.find().sort({ _id: 1 }).lean(), before);
  assert.equal(first.headers["cache-control"], "private, no-store");
  assert.match(first.headers.vary, /Authorization/i);
  for (const entry of first.body.data.photos) assert.deepEqual(Object.keys(entry).sort(), ["liked", "photoId"]);
});

test("like-status uniformly omits missing, pending, rejected and cancellation markers", async () => {
  const hidden = await MemoryPhoto.create([
    { owner: user._id, imageKey: "private/pending", status: "PENDING" },
    { owner: user._id, imageKey: "private/rejected", status: "REJECTED" },
    { owner: user._id, cancelled: true, status: "APPROVED" },
  ]);
  await Like.create(hidden.map(item => ({ photoId: item._id, userId: user._id })));
  const ids = [...hidden.map(item => String(item._id)), String(new mongoose.Types.ObjectId())];
  assert.deepEqual((await likeStatus({ query: `photoIds=${ids.join(",")}` })).body, { status: "success", results: 0, data: { photos: [] } });
  const mixed = await likeStatus({ query: `photoIds=${ids.join(",")},${photo._id}` });
  assert.equal(mixed.status, 200);
  assert.deepEqual(mixed.body.data.photos, [{ photoId: String(photo._id), liked: false }]);
});

test("like-status enforces active student authentication and private error headers", async () => {
  const admin = jwt.sign({ adminId: String(new mongoose.Types.ObjectId()), role: "admin" }, process.env.JWT_SECRET);
  const expired = jwt.sign({ userId: String(user._id), role: "user" }, process.env.JWT_SECRET, { expiresIn: -1 });
  for (const [auth, expected] of [[null, 401], ["invalid", 401], [expired, 401], [admin, 403]]) {
    const response = await likeStatus({ auth }); assert.equal(response.status, expected);
    assert.equal(response.headers["cache-control"], "private, no-store");
  }
  await User.updateOne({ _id: user._id }, { status: "disabled" });
  assert.equal((await likeStatus()).status, 403);
  await User.deleteOne({ _id: user._id }); assert.equal((await likeStatus()).status, 401);
});

test("like-status rejects malformed, duplicate and unsupported query inputs", async () => {
  for (const query of ["", "photoIds=", "photoIds=bad", "photoIds=123456789012", `photoIds=${photo._id},`,
    `photoIds=${photo._id},${photo._id}`, `photoIds=${photo._id},${String(photo._id).toUpperCase()}`,
    `photoIds=${photo._id}&photoIds=${other._id}`, `photoIds[]=${photo._id}`,
    `photoIds=${photo._id}&userId=${other._id}`, `photoIds=${photo._id}&extra=1`,
    `photoIds=${Array.from({ length: 51 }, () => String(new mongoose.Types.ObjectId())).join(",")}`]) {
    const response = await likeStatus({ query }); assert.equal(response.status, 400, query);
    assert.equal(response.headers["cache-control"], "private, no-store");
  }
});

test("like-status accepts the full 50-ID boundary and rejects request bodies including empty JSON", async () => {
  const ids = [String(photo._id), ...Array.from({ length: 49 }, () => String(new mongoose.Types.ObjectId()))];
  const valid = await likeStatus({ query: `photoIds=${ids.join(",")}` });
  assert.equal(valid.status, 200); assert.equal(valid.body.results, 1);
  for (const body of [{}, [], { userId: String(other._id) }]) assert.equal((await likeStatus({ body })).status, 400);
  assert.equal((await likeStatus({ body: "hello", contentType: "text/plain" })).status, 400);
});

test("like-status respects disabled and absent feature configuration", async () => {
  await mutate();
  for (const change of [() => Election.updateOne({}, { memoryPhotosEnabled: false }),
    () => Election.collection.updateOne({}, { $unset: { memoryPhotosEnabled: "" } }), () => Election.deleteMany({})]) {
    await change(); const result = await likeStatus(); assert.equal(result.status, 403);
    assert.equal(result.headers["cache-control"], "private, no-store"); assert.equal(await Like.countDocuments(), 1);
  }
});

test("like-status reads follow idempotent mutations without personalizing the public gallery", async () => {
  assert.equal((await likeStatus()).body.data.photos[0].liked, false);
  await mutate(); await mutate();
  assert.equal((await likeStatus()).body.data.photos[0].liked, true);
  assert.equal((await gallery()).data.photos[0].likeCount, 1);
  assert.deepEqual(Object.keys((await gallery()).data.photos[0]).sort(), ["createdAt", "id", "likeCount"]);
  await mutate("DELETE"); await mutate("DELETE");
  assert.equal((await likeStatus()).body.data.photos[0].liked, false);
  assert.equal((await gallery()).data.photos[0].likeCount, 0);
});
