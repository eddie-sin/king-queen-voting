const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const root = require("node:fs").mkdtempSync(path.join(os.tmpdir(), "memory-admin-roles-"));
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.LOCAL_UPLOAD_DIR = path.join(root, "public");
process.env.MEMORY_PHOTO_UPLOAD_DIR = path.join(root, "private");
const app = require("../app");
const Admin = require("../model/adminsModel");
const User = require("../model/usersModel");
const Election = require("../model/electionModel");
const Photo = require("../model/memoryPhotosModel");
const storage = require("../utils/memoryPhotoStorage");
let mongo;
let exited;
let server;
let base;
let full;
let limited;
let user;
let fullToken;
let limitedToken;
let userToken;
let password;
let passwordHash;
const sign = (account) => jwt.sign({ adminId: String(account._id), role: "admin" }, process.env.JWT_SECRET);

before(async () => {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const dbpath = path.join(root, "mongo");
  await fs.mkdir(dbpath);
  mongo = spawn(process.env.MONGOD_BINARY || "mongod", ["--bind_ip", "127.0.0.1", "--port", String(port),
    "--dbpath", dbpath, "--logpath", path.join(root, "mongo.log")], { stdio: "ignore" });
  let spawnError;
  mongo.on("error", (error) => { spawnError = error; });
  exited = new Promise((resolve) => mongo.once("exit", resolve));
  const client = new mongoose.mongo.MongoClient(`mongodb://127.0.0.1:${port}`, { directConnection: true, serverSelectionTimeoutMS: 300 });
  try {
    for (let attempt = 0; ; attempt++) {
      try { await client.connect(); break; } catch {
        if (spawnError || mongo.exitCode !== null || attempt > 50) throw new Error("Temporary MongoDB could not start");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  } finally { await client.close(); }
  await mongoose.connect(`mongodb://127.0.0.1:${port}/memory_admin_roles_test`);
  await Promise.all([Admin.init(), User.init(), Election.init(), Photo.init()]);
  password = crypto.randomBytes(16).toString("hex");
  passwordHash = await bcrypt.hash(password, 12);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
}, { timeout: 30000 });

beforeEach(async () => {
  await Promise.all([Admin.deleteMany({}), User.deleteMany({}), Election.deleteMany({}), Photo.deleteMany({})]);
  [full, limited] = await Admin.create([
    { username: "full-reviewer", passwordHash, role: "ADMIN" },
    { username: "limited-reviewer", passwordHash, role: "MEMORY_ADMIN" },
  ]);
  user = await User.create({ email: "student@example.com", passwordHash });
  fullToken = sign(full);
  limitedToken = sign(limited);
  userToken = jwt.sign({ userId: String(user._id), role: "user" }, process.env.JWT_SECRET);
  await Election.create({ registrationClosesAt: new Date("2099-01-01"), votingOpensAt: new Date("2099-01-02"),
    votingClosesAt: new Date("2099-01-03"), resultsPublishedAt: new Date("2099-01-04"), memoryPhotosEnabled: false });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo?.pid && mongo.exitCode === null) { mongo.kill("SIGTERM"); await exited; }
  await fs.rm(root, { recursive: true, force: true });
});

const request = async (method, route, body, token = fullToken, extraHeaders = {}) => {
  const response = await fetch(base + route, { method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};
const photo = async () => Photo.create({ owner: user._id,
  imageKey: await storage.uploadImage({ buffer: Buffer.from("private test bytes"), mimetype: "image/png" }) });

test("Admin schema defaults to ADMIN and permits only the two explicit roles", async () => {
  assert.equal(new Admin({ username: "default", passwordHash }).role, "ADMIN");
  for (const role of ["ADMIN", "MEMORY_ADMIN"]) await new Admin({ username: "valid", passwordHash, role }).validate();
  for (const role of [null, "admin", "SUPER_ADMIN", "user"]) {
    await assert.rejects(new Admin({ username: "invalid", passwordHash, role }).validate(), { name: "ValidationError" });
  }
});

test("full admins explicitly provision bcrypt-hashed Memory Admins without exposing hashes or tokens", async () => {
  const result = await request("POST", "/admin/memory-admins", { username: " new-reviewer ", password });
  assert.equal(result.status, 201);
  assert.deepEqual(Object.keys(result.body.data.admin).sort(), ["id", "role", "status", "username"]);
  assert.equal(result.body.data.admin.role, "MEMORY_ADMIN");
  const saved = await Admin.findById(result.body.data.admin.id).select("+passwordHash");
  assert.equal(saved.username, "new-reviewer");
  assert.notEqual(saved.passwordHash, password);
  assert(await bcrypt.compare(password, saved.passwordHash));
  assert.equal(bcrypt.getRounds(saved.passwordHash), 12);
  const login = await request("POST", "/auth/admin/login", { username: saved.username, password }, null);
  assert.equal(login.status, 200);
  assert.equal(login.body.data.admin.role, "MEMORY_ADMIN");
  assert.equal((await request("GET", "/admin/memory-photos", undefined, login.body.data.token)).status, 200);
  assert.equal((await request("GET", "/admin/settings", undefined, login.body.data.token)).status, 403);
});

test("both roles use existing admin login; invalid passwords fail and request roles cannot elevate", async () => {
  for (const account of [full, limited]) {
    const response = await request("POST", "/auth/admin/login", { username: account.username, password, role: "ADMIN" }, null);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.admin.role, account.role);
    const decoded = jwt.verify(response.body.data.token, process.env.JWT_SECRET);
    assert.equal(decoded.role, "admin");
    assert.equal(decoded.adminId, String(account._id));
    const settings = await request("GET", "/admin/settings", undefined, response.body.data.token);
    assert.equal(settings.status, account.role === "ADMIN" ? 200 : 403);
  }
  assert.equal((await request("POST", "/auth/admin/login", { username: limited.username, password: "wrong" }, null)).status, 401);
});

test("both roles moderate while disabled and audit fields identify the actual reviewer", async () => {
  for (const [account, token] of [[full, fullToken], [limited, limitedToken]]) {
    const saved = await photo();
    assert.equal((await request("GET", "/admin/memory-photos", undefined, token)).status, 200);
    const image = await fetch(`${base}/admin/memory-photos/${saved._id}/image`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(image.status, 200);
    assert.equal(await image.text(), "private test bytes");
    const status = account.role === "MEMORY_ADMIN" ? "APPROVED" : "REJECTED";
    const result = await request("PATCH", `/admin/memory-photos/${saved._id}/review`, { status }, token);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.photo.reviewedBy, String(account._id));
    assert.equal(result.body.data.photo.status, status);
    assert.equal(String((await Photo.findById(saved._id)).reviewedBy), String(account._id));
    assert.equal((await request("PATCH", `/admin/memory-photos/${saved._id}/review`, { status: "APPROVED" }, token)).status, 409);
  }
});

test("Memory Admin is denied every existing full-admin and student mutation surface", async () => {
  const id = new mongoose.Types.ObjectId();
  for (const [method, route, body] of [
    ["GET", "/admin/settings"], ["PATCH", "/admin/settings", { memoryPhotosEnabled: true }],
    ["PATCH", "/admin/settings", { votingOpensAt: "2099-01-01T09:00+06:30" }],
    ["GET", "/admin/candidates"], ["GET", `/admin/candidates/${id}`],
    ["POST", "/candidates", {}], ["PATCH", `/candidates/${id}`, {}], ["DELETE", `/candidates/${id}`],
    ["POST", "/images", {}], ["DELETE", `/images/${id}`],
    ["POST", "/voting/submit", {}], ["PATCH", "/voting/change", {}], ["POST", "/voting/my-votes", {}], ["DELETE", "/voting/remove", {}],
    ["POST", "/memory-photos", {}], ["POST", `/memory-photos/${id}/like`], ["DELETE", `/memory-photos/${id}/like`],
    ["POST", "/admin/memory-admins", { username: "forbidden", password }],
    ["GET", "/admin/results"], ["PATCH", `/admin/memory-admins/${limited._id}`, { role: "ADMIN" }],
  ]) assert.equal((await request(method, route, body, limitedToken)).status, 403, `${method} ${route}`);
  assert.equal((await Election.findById("election")).memoryPhotosEnabled, false);
  assert.equal((await Admin.findById(limited._id)).role, "MEMORY_ADMIN");
  // Public settings are public for everyone; no private admin capability is granted.
  assert.equal((await request("GET", "/settings", undefined, limitedToken)).status, 200);
  assert.equal((await request("GET", "/admin/candidates", undefined, fullToken)).status, 200);
  assert.equal((await request("PATCH", "/admin/settings", { memoryPhotosEnabled: true }, fullToken)).status, 200);
});

test("legacy database admins and old JWTs keep all full-admin permissions without migration", async () => {
  const id = new mongoose.Types.ObjectId();
  await Admin.collection.insertOne({ _id: id, username: "legacy-admin", passwordHash, status: "active" });
  const oldToken = sign({ _id: id });
  assert.equal((await request("GET", "/admin/settings", undefined, oldToken)).status, 200);
  assert.equal((await request("GET", "/admin/memory-photos", undefined, oldToken)).status, 200);
  assert.equal((await request("POST", "/admin/memory-admins", { username: "legacy-provisioned", password }, oldToken)).status, 201);
  const login = await request("POST", "/auth/admin/login", { username: "legacy-admin", password }, null);
  assert.equal(login.body.data.admin.role, "ADMIN");
  assert.equal(Object.hasOwn(await Admin.collection.findOne({ _id: id }), "role"), false);
});

test("permissions follow database changes, ignoring forged claims and client role headers", async () => {
  const extraClaims = jwt.sign({ adminId: String(limited._id), role: "admin", adminRole: "ADMIN", permissions: ["*"] }, process.env.JWT_SECRET);
  assert.equal((await request("GET", "/admin/settings", undefined, extraClaims, { "X-Role": "ADMIN" })).status, 403);
  await Admin.updateOne({ _id: full._id }, { role: "MEMORY_ADMIN" });
  assert.equal((await request("GET", "/admin/settings", undefined, fullToken)).status, 403);
  assert.equal((await request("GET", "/admin/memory-photos", undefined, fullToken)).status, 200);
  await Admin.collection.updateOne({ _id: full._id }, { $set: { role: "UNKNOWN" } });
  assert.equal((await request("GET", "/admin/memory-photos", undefined, fullToken)).status, 403);
});

test("only full admins may provision, and public/user registration cannot create admin accounts", async () => {
  for (const [token, expected] of [[null, 401], ["invalid", 401], [userToken, 403], [limitedToken, 403]]) {
    assert.equal((await request("POST", "/admin/memory-admins", { username: "forbidden", password }, token)).status, expected);
  }
  assert.equal((await request("POST", "/auth/admin/register", { username: "forbidden", password, role: "ADMIN" }, null)).status, 404);
  const signup = await request("POST", "/auth/register", { email: "new-student@example.com", password, role: "ADMIN" }, null);
  assert.equal(signup.status, 201);
  assert.equal(await Admin.countDocuments({ username: "forbidden" }), 0);
  const login = await request("POST", "/auth/login", { email: "new-student@example.com", password }, null);
  assert.equal((await request("GET", "/admin/memory-photos", undefined, login.body.data.token)).status, 403);
});

test("provisioning rejects invalid input, injected roles, hashes, statuses and duplicate usernames", async () => {
  for (const body of [{}, { username: " ", password }, { username: "x", password: "short" },
    { username: "x", password: "x".repeat(73) }, { username: {}, password },
    { username: "x", password, role: "ADMIN" }, { username: "x", password, status: "active" },
    { username: "x", password, passwordHash }, { username: "x", password, createdBy: String(full._id) }]) {
    assert.equal((await request("POST", "/admin/memory-admins", body)).status, 400);
  }
  assert.equal((await request("POST", "/admin/memory-admins", { username: limited.username, password })).status, 409);
  assert.equal(await Admin.countDocuments(), 2);
});

test("disabled, deleted, expired and tampered admin identities cannot use moderation or provisioning", async () => {
  const expired = jwt.sign({ adminId: String(limited._id), role: "admin" }, process.env.JWT_SECRET, { expiresIn: -1 });
  const tampered = jwt.sign({ adminId: String(full._id), role: "admin" }, "test-wrong-signing-key");
  for (const token of [expired, tampered]) {
    assert.equal((await request("GET", "/admin/memory-photos", undefined, token)).status, 401);
    assert.equal((await request("POST", "/admin/memory-admins", { username: "forbidden", password }, token)).status, 401);
  }
  await Admin.updateOne({ _id: limited._id }, { status: "disabled" });
  assert.equal((await request("GET", "/admin/memory-photos", undefined, limitedToken)).status, 403);
  assert.equal((await request("POST", "/auth/admin/login", { username: limited.username, password }, null)).status, 403);
  await Admin.deleteOne({ _id: limited._id });
  assert.equal((await request("GET", "/admin/memory-photos", undefined, limitedToken)).status, 401);
});
