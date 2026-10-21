const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.ADMIN_USERNAME = "test-admin";
process.env.ADMIN_PASSWORD = crypto.randomBytes(20).toString("hex");
process.env.AWS_REGION = "ap-southeast-1";
const testUploadDirectory = require("node:fs").mkdtempSync(path.join(os.tmpdir(), "king-queen-api-uploads-"));
process.env.LOCAL_UPLOAD_DIR = testUploadDirectory;

const app = require("../app");
const User = require("../model/usersModel");
const Admin = require("../model/adminsModel");
const Election = require("../model/electionModel");
const Candidate = require("../model/candidatesModel");
const Ballot = require("../model/ballotsModel");
const Credential = require("../model/voting_credentialsModel");
const Results = require("../model/resultsModel");
const Wish = require("../model/wishesModel");
const Image = require("../model/imagesModel");
const clock = require("../utils/clock");
const { seed } = require("../utils/seed");
const { finalizeResultsIfDue } = require("../utils/results");
const { withElectionOperation } = require("../utils/election");

let mongo;
let mongoExit;
let databasePath;
let server;
let base;
let adminToken;
let currentTime;
let testDatabaseUri;
const actualClock = clock.now;
clock.now = () => new Date(currentTime);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const listener = net.createServer();
  listener.on("error", reject);
  listener.listen(0, "127.0.0.1", () => {
    const { port } = listener.address();
    listener.close(() => resolve(port));
  });
});

const request = async (method, endpoint, body, token) => {
  const response = await fetch(`${base}/api/v1${endpoint}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data, headers: response.headers };
};

const register = async (email = `${crypto.randomUUID()}@example.com`) => {
  const result = await request("POST", "/auth/register", { email, password: "testing-password" });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const login = await request("POST", "/auth/login", { email, password: "testing-password" });
  assert.equal(login.status, 200);
  return { ...result.data.data, token: login.data.data.token, email };
};

const makeCandidate = async (category = "king", extra = {}) => {
  const response = await request("POST", "/candidates", {
    fullName: `Candidate ${crypto.randomUUID()}`, batchNumber: "1", images: ["https://example.com/image.jpg"],
    contactNumber: "09123456789", category, ...extra,
  }, adminToken);
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data.data.candidate;
};

const setTime = (time) => { currentTime = new Date(time); };
const openVoting = () => setTime("2026-10-28T09:00:00+06:30");
const vote = (voter, candidate, contest = "king", key = voter.votingKey) => request("POST", "/voting/submit", { votingKey: key, candidateId: candidate._id, contest }, voter.token);

before(async () => {
  databasePath = await fs.mkdtemp(path.join(os.tmpdir(), "king-queen-api-test-"));
  const port = await freePort();
  mongo = spawn(process.env.MONGOD_BINARY || "mongod", [
    "--bind_ip", "127.0.0.1", "--port", String(port),
    "--dbpath", databasePath, "--logpath", path.join(databasePath, "mongod.log"),
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let spawnError;
  mongo.on("error", (error) => { spawnError = error; });
  mongoExit = new Promise((resolve) => mongo.once("exit", resolve));
  const uri = `mongodb://127.0.0.1:${port}`;
  const client = new mongoose.mongo.MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 300 });
  for (let attempt = 0; ; attempt++) {
    try { await client.connect(); break; } catch (error) {
      if (spawnError || mongo.exitCode !== null || attempt >= 50) {
        throw new Error(`Cannot start temporary mongod: ${spawnError?.message || error.message}`);
      }
      await sleep(100);
    }
  }
  const hello = await client.db("admin").command({ hello: 1 });
  assert.equal(hello.setName, undefined, "Tests must use standalone MongoDB");
  await client.close();
  testDatabaseUri = `${uri}/voting_test`;
  await mongoose.connect(testDatabaseUri);
  currentTime = new Date("2026-10-20T09:00:00+06:30");
  await seed();
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await request("POST", "/auth/admin/login", { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  adminToken = login.data.data.token;
}, { timeout: 30000 });

beforeEach(async () => {
  setTime("2026-10-20T09:00:00+06:30");
  for (const Model of [User, Credential, Candidate, Ballot, Election, Results, Wish, Image]) await Model.deleteMany({});
  await seed();
});

after(async () => {
  clock.now = actualClock;
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo && mongo.exitCode === null) { mongo.kill("SIGTERM"); await mongoExit; }
  if (databasePath) await fs.rm(databasePath, { recursive: true, force: true });
  await fs.rm(testUploadDirectory, { recursive: true, force: true });
});

test("startup seeds fixed Myanmar dates and a hashed admin without overwriting changes", async () => {
  const admin = await Admin.findOne().select("+passwordHash");
  assert.notEqual(admin.passwordHash, process.env.ADMIN_PASSWORD);
  assert(await bcrypt.compare(process.env.ADMIN_PASSWORD, admin.passwordHash));
  const initialHash = admin.passwordHash;
  const response = await request("GET", "/settings");
  assert.equal(response.status, 200);
  const schedule = response.data.data.schedule;
  assert.equal(schedule.votingOpensAt, "2026-10-28T09:00:00.000+06:30");
  assert.equal(schedule.votingClosesAt, "2026-11-02T23:59:59.999+06:30");
  assert.equal(schedule.resultsPublishedAt, "2026-11-03T09:00:00.000+06:30");
  assert.equal(schedule.registrationClosesAt, "2026-11-06T23:59:59.999+06:30");
  await request("PATCH", "/admin/settings", { registrationClosesAt: "2026-11-07T23:59+06:30" }, adminToken);
  await seed();
  assert.equal((await Election.findById("election")).registrationClosesAt.toISOString(), "2026-11-07T17:29:59.999Z");
  assert.equal((await Admin.findOne().select("+passwordHash")).passwordHash, initialHash);
});

test("admins can enable and disable Memory Photo without changing other settings", async () => {
  const initial = (await request("GET", "/settings")).data.data.schedule;
  assert.equal(initial.memoryPhotosEnabled, false);
  for (const enabled of [true, false]) {
    const response = await request("PATCH", "/admin/settings", { memoryPhotosEnabled: enabled }, adminToken);
    assert.equal(response.status, 200);
    assert.deepEqual(response.data.data.schedule, { ...initial, memoryPhotosEnabled: enabled });
    assert.equal((await Election.collection.findOne({ _id: "election" })).memoryPhotosEnabled, enabled);
    await seed();
    const publicSettings = await request("GET", "/settings");
    assert.equal(publicSettings.status, 200);
    assert.equal(publicSettings.data.data.schedule.memoryPhotosEnabled, enabled);
    assert.equal((await request("GET", "/admin/settings", undefined, adminToken)).data.data.schedule.memoryPhotosEnabled, enabled);
  }
});

test("Memory Photo requires an actual Boolean and rejects mixed invalid updates atomically", async () => {
  await request("PATCH", "/admin/settings", { memoryPhotosEnabled: true }, adminToken);
  const initial = (await request("GET", "/settings")).data.data.schedule;
  for (const value of ["true", "false", "", 0, 1, null, [], {}]) {
    const response = await request("PATCH", "/admin/settings", {
      memoryPhotosEnabled: value, registrationClosesAt: "2026-11-07T23:59+06:30",
    }, adminToken);
    assert.equal(response.status, 400);
    assert.match(response.data.message, /memoryPhotosEnabled must be a Boolean/);
    assert.deepEqual((await request("GET", "/settings")).data.data.schedule, initial);
  }
  for (const body of [
    { memoryPhotosEnabled: false, unknownSetting: true },
    { memoryPhotosEnabled: false, votingOpensAt: "invalid" },
  ]) {
    assert.equal((await request("PATCH", "/admin/settings", body, adminToken)).status, 400);
    assert.deepEqual((await request("GET", "/settings")).data.data.schedule, initial);
  }
});

test("anonymous callers and ordinary users cannot change Memory Photo", async () => {
  const voter = await register();
  for (const enabled of [true, false]) {
    // Start with the opposite value to prove rejected requests cannot mutate it.
    await request("PATCH", "/admin/settings", { memoryPhotosEnabled: !enabled }, adminToken);
    assert.equal((await request("PATCH", "/admin/settings", { memoryPhotosEnabled: enabled })).status, 401);
    assert.equal((await request("PATCH", "/admin/settings", { memoryPhotosEnabled: enabled }, voter.token)).status, 403);
    assert.equal((await Election.findById("election")).memoryPhotosEnabled, !enabled);
  }
});

test("old election documents without Memory Photo remain disabled and can be enabled", async () => {
  await Election.collection.updateOne({ _id: "election" }, { $unset: { memoryPhotosEnabled: "" } });
  assert.equal(Object.hasOwn(await Election.collection.findOne({ _id: "election" }), "memoryPhotosEnabled"), false);
  await seed();
  assert.equal((await request("GET", "/settings")).data.data.schedule.memoryPhotosEnabled, false);
  assert.equal((await request("GET", "/admin/settings", undefined, adminToken)).data.data.schedule.memoryPhotosEnabled, false);
  const response = await request("PATCH", "/admin/settings", { memoryPhotosEnabled: true }, adminToken);
  assert.equal(response.status, 200);
  assert.equal((await Election.collection.findOne({ _id: "election" })).memoryPhotosEnabled, true);
});

test("Memory Photo can be updated together with existing date settings", async () => {
  const response = await request("PATCH", "/admin/settings", {
    memoryPhotosEnabled: true, registrationClosesAt: "2026-11-07T23:59+06:30",
  }, adminToken);
  assert.equal(response.status, 200);
  assert.equal(response.data.data.schedule.memoryPhotosEnabled, true);
  assert.equal(response.data.data.schedule.registrationClosesAt, "2026-11-07T23:59:59.999+06:30");
});

test("public candidates hide inactive entries and contact numbers; admin sees and edits all fields", async () => {
  const active = await makeCandidate();
  const inactive = await makeCandidate("queen", { isActive: false });
  assert.equal(active.isActive, true);
  const publicList = await request("GET", "/candidates");
  assert.equal(publicList.data.results, 1);
  assert.equal(publicList.data.data.candidates[0].contactNumber, undefined);
  assert.equal((await request("GET", `/candidates/${inactive._id}`)).status, 404);
  const adminList = await request("GET", "/admin/candidates", undefined, adminToken);
  assert.equal(adminList.data.results, 2);
  assert(adminList.data.data.candidates.every((candidate) => candidate.contactNumber));
  const edit = await request("PATCH", `/candidates/${active._id}`, { fullName: "Edited", contactNumber: "09999", isActive: false }, adminToken);
  assert.equal(edit.status, 200);
  assert.equal(edit.data.data.candidate.contactNumber, "09999");
  assert.equal((await request("DELETE", `/candidates/${inactive._id}`, undefined, adminToken)).status, 204);
});

test("candidate and gallery mutations require an admin, not a normal user", async () => {
  const voter = await register();
  const candidate = await makeCandidate();
  for (const [method, endpoint] of [["POST", "/candidates"], ["PATCH", `/candidates/${candidate._id}`], ["DELETE", `/candidates/${candidate._id}`], ["POST", "/images"], ["DELETE", `/images/${candidate._id}`]]) {
    assert.equal((await request(method, endpoint, {}, undefined)).status, 401);
    assert.equal((await request(method, endpoint, {}, voter.token)).status, 403);
  }
  assert.equal((await request("PATCH", "/admin/settings", {}, voter.token)).status, 403);
});

test("registration hides hashes, creates an account-bound key, and requires valid input", async () => {
  const voter = await register("voter@example.com");
  assert.equal(voter.votingKey.length, 64);
  assert.equal(voter.user.hasVotedKing, false);
  assert.equal(voter.user.hasVotedQueen, false);
  const stored = await User.findById(voter.user.id).select("+passwordHash");
  assert.equal(stored.fullName, undefined);
  assert.equal(stored.batchNumber, undefined);
  assert.equal(voter.user.fullName, undefined);
  assert.equal(voter.user.batchNumber, undefined);
  assert(await bcrypt.compare("testing-password", stored.passwordHash));
  const credential = await Credential.findOne().lean();
  assert.equal(credential.userId, undefined);
  assert.equal(credential.user, undefined);
  assert.equal(credential.bindingVersion, 2);
  assert.notEqual(credential.codeHash, voter.votingKey);
  const duplicate = await request("POST", "/auth/register", { email: "VOTER@example.com", password: "testing-password" });
  assert.equal(duplicate.status, 409);
  const invalid = await request("POST", "/auth/register", { email: "bad", password: "short" });
  assert.equal(invalid.status, 400);
  assert.equal(await User.countDocuments(), 1);
  assert.equal(await Credential.countDocuments(), 1);
  const me = await request("GET", "/auth/me", undefined, voter.token);
  assert.equal(me.data.data.user.passwordHash, undefined);
  assert.equal(me.data.data.votingKey, undefined);
});

test("account and credential creation roll back together on database failure", async () => {
  const originalCreate = Credential.create;
  Credential.create = async () => { throw new (require("../utils/appError"))("Injected credential failure", 503); };
  try {
    const result = await request("POST", "/auth/register", { email: "failed@example.com", password: "testing-password" });
    assert.equal(result.status, 503);
    assert.equal(await User.countDocuments(), 0);
    assert.equal(await Credential.countDocuments(), 0);
  } finally { Credential.create = originalCreate; }
});

test("a key cannot be used by another logged-in account and every key operation needs a JWT", async () => {
  const owner = await register();
  const other = await register();
  const candidate = await makeCandidate();
  openVoting();
  assert.equal((await vote(other, candidate, "king", owner.votingKey)).status, 401);
  for (const [method, endpoint] of [["POST", "/voting/submit"], ["PATCH", "/voting/change"], ["POST", "/voting/my-votes"], ["DELETE", "/voting/remove"]]) {
    assert.equal((await request(method, endpoint, { votingKey: owner.votingKey, candidateId: candidate._id, contest: "king" })).status, 401);
    assert.equal((await request(method, endpoint, { candidateId: candidate._id, contest: "king" }, owner.token)).status, 400);
    assert.equal((await request(method, endpoint, { votingKey: owner.votingKey, candidateId: candidate._id, contest: "king" }, other.token)).status, 401);
  }
  assert.equal(await Ballot.countDocuments(), 0);
});

test("voting supports one per contest, key-protected viewing, changes, removal, and voting again", async () => {
  const voter = await register();
  const king = await makeCandidate();
  const anotherKing = await makeCandidate();
  const queen = await makeCandidate("queen");
  openVoting();
  assert.equal((await vote(voter, king)).status, 201);
  assert.equal((await vote(voter, queen, "queen")).status, 201);
  assert.equal((await vote(voter, anotherKing)).status, 409);
  let me = await request("GET", "/auth/me", undefined, voter.token);
  assert.equal(me.data.data.user.hasVotedKing, true);
  assert.equal(me.data.data.user.hasVotedQueen, true);
  assert.equal(me.data.data.user.candidate, undefined);
  let chosen = await request("POST", "/voting/my-votes", { votingKey: voter.votingKey }, voter.token);
  assert.equal(chosen.data.data.votes.length, 2);
  assert(chosen.data.data.votes.every((ballot) => !ballot.credential && !ballot.candidate.contactNumber));
  const changed = await request("PATCH", "/voting/change", { votingKey: voter.votingKey, candidateId: anotherKing._id, contest: "king" }, voter.token);
  assert.equal(changed.status, 200);
  chosen = await request("POST", "/voting/my-votes", { votingKey: voter.votingKey }, voter.token);
  assert.equal(chosen.data.data.votes.find((ballot) => ballot.contest === "king").candidate._id, anotherKing._id);
  assert.equal(await Ballot.countDocuments(), 2);
  assert.equal((await request("DELETE", "/voting/remove", { votingKey: voter.votingKey, contest: "king" }, voter.token)).status, 200);
  me = await request("GET", "/auth/me", undefined, voter.token);
  assert.equal(me.data.data.user.hasVotedKing, false);
  assert.equal(me.data.data.user.hasVotedQueen, true);
  assert.equal((await vote(voter, king)).status, 201);
});

test("missing votes, invalid candidates, and inactive or wrong-category candidates are rejected", async () => {
  const voter = await register();
  const king = await makeCandidate();
  const inactive = await makeCandidate("king", { isActive: false });
  const queen = await makeCandidate("queen");
  openVoting();
  assert.equal((await vote(voter, inactive)).status, 400);
  assert.equal((await vote(voter, queen)).status, 400);
  assert.equal((await vote(voter, { _id: "bad" })).status, 400);
  assert.equal((await request("PATCH", "/voting/change", { votingKey: voter.votingKey, candidateId: king._id, contest: "king" }, voter.token)).status, 404);
  assert.equal((await request("DELETE", "/voting/remove", { votingKey: voter.votingKey, contest: "king" }, voter.token)).status, 404);
  assert.equal(await Ballot.countDocuments(), 0);
});

test("all key operations are restricted to the exact voting period; registration remains independent", async () => {
  const voter = await register();
  const king = await makeCandidate();
  for (const time of ["2026-10-28T08:59:59.999+06:30", "2026-11-03T00:00:00+06:30"]) {
    setTime(time);
    for (const [method, endpoint] of [["POST", "/voting/submit"], ["PATCH", "/voting/change"], ["POST", "/voting/my-votes"], ["DELETE", "/voting/remove"]]) {
      const result = await request(method, endpoint, { votingKey: voter.votingKey, candidateId: king._id, contest: "king" }, voter.token);
      assert.equal(result.status, 403, `${time} ${endpoint}`);
    }
  }
  openVoting();
  assert.equal((await vote(voter, king)).status, 201);
  setTime("2026-11-02T23:59:59.999+06:30");
  assert.equal((await request("POST", "/voting/my-votes", { votingKey: voter.votingKey }, voter.token)).status, 200);
  setTime("2026-11-06T23:59:59.999+06:30");
  await register();
  setTime("2026-11-07T00:00:00+06:30");
  const closed = await request("POST", "/auth/register", { email: "late@example.com", password: "testing-password" });
  assert.equal(closed.status, 403);
  assert.equal((await request("POST", "/auth/login", { email: voter.email, password: "testing-password" })).status, 200);
});

test("disabled and deleted users cannot keep using existing JWTs", async () => {
  const voter = await register();
  const king = await makeCandidate();
  openVoting();
  await User.updateOne({ _id: voter.user.id }, { status: "disabled" });
  assert.equal((await vote(voter, king)).status, 403);
  assert.equal((await request("GET", "/auth/me", undefined, voter.token)).status, 403);
  await User.deleteOne({ _id: voter.user.id });
  assert.equal((await vote(voter, king)).status, 401);
  const expired = jwt.sign({ userId: voter.user.id }, process.env.JWT_SECRET, { expiresIn: -1 });
  assert.equal((await request("GET", "/auth/me", undefined, expired)).status, 401);
});

test("concurrent duplicate submissions and removals preserve ballot/status consistency", async () => {
  const voter = await register();
  const king = await makeCandidate();
  openVoting();
  const submissions = await Promise.all([vote(voter, king), vote(voter, king)]);
  assert.deepEqual(submissions.map((result) => result.status).sort(), [201, 409]);
  assert.equal(await Ballot.countDocuments(), 1);
  assert.equal((await User.findById(voter.user.id)).hasVotedKing, true);
  const removals = await Promise.all([0, 1].map(() => request("DELETE", "/voting/remove", { votingKey: voter.votingKey, contest: "king" }, voter.token)));
  assert.deepEqual(removals.map((result) => result.status).sort(), [200, 404]);
  assert.equal(await Ballot.countDocuments(), 0);
  assert.equal((await User.findById(voter.user.id)).hasVotedKing, false);
});

test("a status update failure rolls back the corresponding ballot", async () => {
  const voter = await register();
  const king = await makeCandidate();
  openVoting();
  const originalUpdate = User.updateOne;
  let injected = false;
  User.updateOne = (...args) => {
    if (!injected) {
      injected = true;
      throw new (require("../utils/appError"))("Injected status failure", 503);
    }
    return originalUpdate.apply(User, args);
  };
  try {
    assert.equal((await vote(voter, king)).status, 503);
    assert.equal(await Ballot.countDocuments(), 0);
    assert.equal((await User.findById(voter.user.id)).hasVotedKing, false);
  } finally { User.updateOne = originalUpdate; }
});

test("candidate management stays permanently locked after moving the start into the future", async () => {
  const king = await makeCandidate();
  openVoting();
  // No maintenance tick or candidate request is needed before the settings edit.
  const changed = await request("PATCH", "/admin/settings", {
    votingOpensAt: "2026-10-30T09:00+06:30",
  }, adminToken);
  assert.equal(changed.status, 200);
  assert.equal(changed.data.data.schedule.candidateManagementLocked, true);
  for (const [method, endpoint] of [["POST", "/candidates"], ["PATCH", `/candidates/${king._id}`], ["DELETE", `/candidates/${king._id}`]]) {
    assert.equal((await request(method, endpoint, { bio: "changed" }, adminToken)).status, 403);
  }
  await seed();
  assert.equal((await Election.findById("election")).candidateManagementLocked, true);
});

test("candidate writes recheck the lock after upload and serialize with schedule changes", async () => {
  const king = await makeCandidate();
  openVoting();
  await assert.rejects(withElectionOperation("candidate", async () => Candidate.deleteOne({ _id: king._id })), { statusCode: 403 });
  assert(await Candidate.exists({ _id: king._id }));
});

test("admins can change only valid date values, never labels, timezone, or lock", async () => {
  for (const body of [
    { timezone: "UTC" }, { timezoneLabel: "UTC" }, { labels: {} }, { candidateManagementLocked: false },
    { votingClosesAt: "2026-10-27T09:00+06:30" }, { resultsPublishedAt: "2026-11-01T09:00+06:30" },
    { votingOpensAt: "2026-10-28T09:00Z" }, { registrationClosesAt: "2026-02-30T09:00+06:30" },
  ]) {
    assert.equal((await request("PATCH", "/admin/settings", body, adminToken)).status, 400, JSON.stringify(body));
  }
  const updated = await request("PATCH", "/admin/settings", { votingOpensAt: "2026-10-27T09:00+06:30" }, adminToken);
  assert.equal(updated.status, 200);
  assert.equal(updated.data.data.schedule.timezone, "Asia/Yangon");
});

test("finalists include zero-vote candidates, randomize cutoff ties, and remain saved across requests", async () => {
  const kings = [];
  for (let i = 0; i < 7; i++) kings.push(await makeCandidate());
  for (let i = 0; i < 6; i++) await makeCandidate("queen");
  await makeCandidate("king", { isActive: false });
  const voter = await register();
  openVoting();
  assert.equal((await vote(voter, kings[0])).status, 201);
  assert.equal((await request("GET", "/results")).status, 403);
  setTime("2026-11-03T00:00:00+06:30");
  await Promise.all([finalizeResultsIfDue(), finalizeResultsIfDue()]);
  assert.equal(await Results.countDocuments(), 1);
  assert.equal((await request("GET", "/results")).status, 403);
  setTime("2026-11-03T09:00:00+06:30");
  const responses = await Promise.all([request("GET", "/results"), request("GET", "/results")]);
  assert(responses.every((result) => result.status === 200));
  const results = responses[0].data.data.results;
  assert.deepEqual(results, responses[1].data.data.results);
  assert.equal(results.kings.length, 5);
  assert.equal(results.queens.length, 5);
  assert.equal(results.kings[0].candidate._id, kings[0]._id);
  assert.equal(results.kings[0].votes, 1);
  assert.equal(results.kings[0].selectedByTieBreak, false);
  assert(results.kings.slice(1).every((entry) => entry.selectedByTieBreak && entry.votes === 0));
  assert(results.queens.every((entry) => entry.selectedByTieBreak));
  assert(results.kings.every((entry) => !entry.candidate.contactNumber));
  assert.equal(responses[0].headers.get("cache-control"), "no-store");
  await seed();
  await finalizeResultsIfDue();
  assert.deepEqual((await request("GET", "/results")).data.data.results, results);
  assert.equal((await request("PATCH", "/admin/settings", { votingClosesAt: "2026-11-04T23:59+06:30", resultsPublishedAt: "2026-11-05T09:00+06:30" }, adminToken)).status, 409);
});

test("results finalize on demand after downtime, with fewer than five eligible candidates", async () => {
  await makeCandidate();
  setTime("2026-11-03T09:00:00+06:30");
  const result = await request("GET", "/results");
  assert.equal(result.status, 200);
  assert.equal(result.data.data.results.kings.length, 1);
  assert.equal(result.data.data.results.queens.length, 0);
  assert.equal((await Election.findById("election")).candidateManagementLocked, true);
});

test("legacy unbound keys are rejected instead of being claimed by an arbitrary account", async () => {
  const voter = await register();
  const king = await makeCandidate();
  await Credential.collection.updateOne({}, { $set: { codeHash: crypto.createHash("sha256").update(voter.votingKey).digest("hex") }, $unset: { bindingVersion: "" } });
  openVoting();
  assert.equal((await vote(voter, king)).status, 401);
});

test("requests crossing a deadline compensate candidate and ballot writes", async () => {
  const king = await makeCandidate();
  const voter = await register();
  const originalCandidateSave = Candidate.prototype.save;
  setTime("2026-10-28T08:59:59.999+06:30");
  Candidate.prototype.save = async function (...args) {
    const result = await originalCandidateSave.apply(this, args);
    openVoting();
    return result;
  };
  try {
    assert.equal((await request("PATCH", `/candidates/${king._id}`, { bio: "must undo" }, adminToken)).status, 403);
    assert.equal((await Candidate.findById(king._id)).bio, undefined);
    assert.equal((await Election.findById("election")).candidateManagementLocked, true);
  } finally { Candidate.prototype.save = originalCandidateSave; }

  const originalBallotSave = Ballot.prototype.save;
  setTime("2026-11-02T23:59:59.999+06:30");
  Ballot.prototype.save = async function (...args) {
    const result = await originalBallotSave.apply(this, args);
    setTime("2026-11-03T00:00:00+06:30");
    return result;
  };
  try {
    assert.equal((await vote(voter, king)).status, 403);
    assert.equal(await Ballot.countDocuments(), 0);
    assert.equal((await User.findById(voter.user.id)).hasVotedKing, false);
  } finally { Ballot.prototype.save = originalBallotSave; }
});

test("revoked keys are rejected and admin tokens cannot be used as voter tokens", async () => {
  const voter = await register();
  const king = await makeCandidate();
  openVoting();
  await Credential.updateMany({}, { status: "revoked" });
  assert.equal((await vote(voter, king)).status, 401);
  assert.equal((await request("POST", "/voting/my-votes", { votingKey: voter.votingKey }, adminToken)).status, 403);
});

test("development and production start successfully with standalone MongoDB", async () => {
  assert.equal((await request("PATCH", "/admin/settings", { memoryPhotosEnabled: true }, adminToken)).status, 200);
  const storedImage = "startup-storage-check.png";
  await fs.writeFile(path.join(testUploadDirectory, storedImage), Buffer.from("local-only"));
  for (const mode of ["development", "production"]) {
    const port = await freePort();
    // Resolve source absolutely but run from a disposable directory, so dotenv
    // cannot load the developer's real config.env during startup regression tests.
    const child = spawn(process.execPath, [path.resolve(__dirname, "..", "server.js")], {
      cwd: testUploadDirectory,
      env: {
        ...process.env, NODE_ENV: mode, PORT: String(port),
        DATABASE: mode === "production" ? testDatabaseUri : "mongodb://127.0.0.1:1/must_not_use",
        DATABASE_LOCAL: mode === "development" ? testDatabaseUri : "mongodb://127.0.0.1:1/must_not_use",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const closed = new Promise((resolve) => child.once("exit", resolve));
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/v1/settings`);
          assert.equal(response.status, 200);
          const schedule = (await response.json()).data.schedule;
          assert.equal(schedule.timezone, "Asia/Yangon");
          assert.equal(schedule.memoryPhotosEnabled, mode === "development");
          break;
        } catch (error) {
          if (child.exitCode !== null || attempt >= 100) throw Error(`${mode} startup failed: ${output} ${error.message}`);
          await sleep(100);
        }
      }
      assert.match(output, /Server running/);
      const localFile = await fetch(`http://127.0.0.1:${port}/uploads/${storedImage}`);
      assert.equal(localFile.status, mode === "development" ? 200 : 404);
    } finally {
      if (child.exitCode === null) child.kill("SIGTERM");
      await closed;
    }
    // The next process must load the newly saved disabled value from MongoDB.
    if (mode === "development") {
      assert.equal((await request("PATCH", "/admin/settings", { memoryPhotosEnabled: false }, adminToken)).status, 200);
    }
  }
});


test("failed vote changes and removals restore the existing ballot and participation flag", async () => {
  const voter = await register();
  const king = await makeCandidate();
  const other = await makeCandidate();
  openVoting();
  assert.equal((await vote(voter, king)).status, 201);
  for (const [method, endpoint, body] of [
    ["PATCH", "/voting/change", { candidateId: other._id }],
    ["DELETE", "/voting/remove", {}],
  ]) {
    const originalUpdate = User.updateOne;
    let failOnce = true;
    User.updateOne = (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new (require("../utils/appError"))("Injected flag failure", 503);
      }
      return originalUpdate.apply(User, args);
    };
    try {
      const result = await request(method, endpoint, { ...body, votingKey: voter.votingKey, contest: "king" }, voter.token);
      assert.equal(result.status, 503);
      assert.equal(await Ballot.countDocuments(), 1);
      assert.equal((await Ballot.findOne()).candidate.toString(), king._id);
      assert.equal((await User.findById(voter.user.id)).hasVotedKing, true);
    } finally { User.updateOne = originalUpdate; }
  }
});

test("a successful key request repairs participation flags left by an interrupted process", async () => {
  const voter = await register();
  const king = await makeCandidate();
  openVoting();
  assert.equal((await vote(voter, king)).status, 201);
  await User.updateOne({ _id: voter.user.id }, { hasVotedKing: false, hasVotedQueen: true });
  const result = await request("POST", "/voting/my-votes", { votingKey: voter.votingKey }, voter.token);
  assert.equal(result.status, 200);
  const me = await request("GET", "/auth/me", undefined, voter.token);
  assert.equal(me.data.data.user.hasVotedKing, true);
  assert.equal(me.data.data.user.hasVotedQueen, false);
});

test("concurrent independent finalist inserts retain the same saved draw on standalone MongoDB", async () => {
  for (let i = 0; i < 7; i++) await makeCandidate();
  setTime("2026-11-03T09:00:00+06:30");
  const { getOrCreateResults } = require("../utils/results");
  const results = await Promise.all([0, 1, 2].map(() => getOrCreateResults({ now: clock.now() })));
  const ids = (result) => result.kings.map((entry) => entry.candidate.toString());
  assert.deepEqual(ids(results[0]), ids(results[1]));
  assert.deepEqual(ids(results[0]), ids(results[2]));
  assert.equal(await Results.countDocuments(), 1);
});


test("candidate and gallery uploads save locally and are publicly served without an account", async () => {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6T8AAAAASUVORK5CYII=", "base64");
  const candidateForm = new FormData();
  for (const [key, value] of Object.entries({ fullName: "Photo Candidate", batchNumber: "1", contactNumber: "0912345", category: "king" })) {
    candidateForm.append(key, value);
  }
  candidateForm.append("images", new Blob([bytes], { type: "image/png" }), "photo.png");
  const created = await fetch(`${base}/api/v1/candidates`, {
    method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: candidateForm,
  });
  assert.equal(created.status, 201);
  const candidate = (await created.json()).data.candidate;
  assert.match(candidate.images[0], /^\/uploads\/candidates\/[a-f0-9-]+\.png$/);
  const image = await fetch(`${base}${candidate.images[0]}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);

  const galleryForm = new FormData();
  galleryForm.append("section", "memory");
  galleryForm.append("images", new Blob([bytes], { type: "image/png" }), "memory.png");
  const gallery = await fetch(`${base}/api/v1/images`, {
    method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: galleryForm,
  });
  assert.equal(gallery.status, 201);
  const url = (await gallery.json()).data.images[0].url;
  assert.match(url, /^\/uploads\/gallery\/memory\/[a-f0-9-]+\.png$/);
  assert.equal((await fetch(`${base}${url}`)).status, 200);

  const invalidForm = new FormData();
  invalidForm.append("section", "../../outside");
  invalidForm.append("images", new Blob([bytes], { type: "image/png" }), "bad.png");
  assert.equal((await fetch(`${base}/api/v1/images`, {
    method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: invalidForm,
  })).status, 400);
});

test("admin creates one titled lantern and public visitors receive its matching information", async () => {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6T8AAAAASUVORK5CYII=", "base64");
  const form = new FormData();
  form.append("section", "lantern");
  form.append("title", "  Golden Moon Lantern  ");
  form.append("description", "  Handmade with bamboo and gold paper.  ");
  form.append("images", new Blob([bytes], { type: "image/png" }), "lantern.png");
  const createdResponse = await fetch(`${base}/api/v1/images`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: form });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).data.images;
  assert.equal(created.length, 1);
  assert.equal(created[0].title, "Golden Moon Lantern");
  assert.equal(created[0].description, "Handmade with bamboo and gold paper.");
  assert.match(created[0].url, /^\/uploads\/gallery\/lantern\/[a-f0-9-]+\.png$/);

  const publicResponse = await request("GET", "/images?section=lantern");
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.data.results, 1);
  assert.deepEqual(publicResponse.data.data.images.map(({ title, description, url }) => ({ title, description, url })), [{
    title: "Golden Moon Lantern", description: "Handmade with bamboo and gold paper.", url: created[0].url,
  }]);
  assert.equal((await fetch(`${base}${created[0].url}`)).status, 200);
});

test("lantern writes require admins, one image, and valid correctly associated metadata", async () => {
  const user = await register();
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6T8AAAAASUVORK5CYII=", "base64");
  const upload = async ({ token, title = "Lantern", description = "Details", files = 1 } = {}) => {
    const form = new FormData(); form.append("section", "lantern"); form.append("title", title); form.append("description", description);
    for (let index = 0; index < files; index += 1) form.append("images", new Blob([bytes], { type: "image/png" }), `${index}.png`);
    return fetch(`${base}/api/v1/images`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  };
  assert.equal((await upload()).status, 401);
  assert.equal((await upload({ token: user.token })).status, 403);
  for (const invalid of [
    { token: adminToken, title: "   " }, { token: adminToken, title: "x".repeat(121) },
    { token: adminToken, description: "x".repeat(1001) }, { token: adminToken, files: 2 },
  ]) assert.equal((await upload(invalid)).status, 400);
  assert.equal(await Image.countDocuments(), 0);

  const first = await upload({ token: adminToken, title: "First", description: "First details" });
  const second = await upload({ token: adminToken, title: "Second", description: "Second details" });
  assert.equal(first.status, 201); assert.equal(second.status, 201);
  const listed = (await request("GET", "/images?section=lantern")).data.data.images;
  assert.deepEqual(new Map(listed.map(image => [image.title, image.description])), new Map([["First", "First details"], ["Second", "Second details"]]));
});

test("only admins edit or delete lantern metadata while legacy galleries remain compatible", async () => {
  const user = await register();
  const legacyLantern = await Image.collection.insertOne({ section: "lantern", url: "/uploads/gallery/lantern/legacy.png", caption: "Legacy", createdAt: new Date() });
  const memory = await Image.create({ section: "memory", url: "/uploads/gallery/memory/old.png", caption: "Old memory" });
  const publicLegacy = await request("GET", "/images?section=lantern");
  assert.equal(publicLegacy.status, 200);
  assert.equal(publicLegacy.data.data.images[0].title, undefined);

  const id = legacyLantern.insertedId.toString();
  assert.equal((await request("PATCH", `/images/${id}`, { title: "Lit Legacy" })).status, 401);
  assert.equal((await request("PATCH", `/images/${id}`, { title: "Lit Legacy" }, user.token)).status, 403);
  assert.equal((await request("DELETE", `/images/${id}`, undefined, user.token)).status, 403);
  assert.equal((await request("PATCH", `/images/${memory._id}`, { title: "Not allowed" }, adminToken)).status, 400);
  assert.equal((await request("PATCH", `/images/${id}`, { section: "memory", title: "Not allowed" }, adminToken)).status, 400);
  assert.equal((await request("PATCH", `/images/${id}`, { title: "   " }, adminToken)).status, 400);
  assert.equal((await request("PATCH", `/images/${id}`, { title: "Valid", description: 7 }, adminToken)).status, 400);

  const edited = await request("PATCH", `/images/${id}`, { title: "  Lit Legacy  ", description: "  Restored for the festival.  " }, adminToken);
  assert.equal(edited.status, 200);
  assert.equal(edited.data.data.image.title, "Lit Legacy");
  assert.equal(edited.data.data.image.description, "Restored for the festival.");
  assert.equal(edited.data.data.image.url, "/uploads/gallery/lantern/legacy.png");
  assert.equal((await request("DELETE", `/images/${id}`)).status, 401);
  assert.equal((await request("DELETE", `/images/${id}`, undefined, adminToken)).status, 204);
  assert.equal(await Image.exists({ _id: id }), null);

  const oldGallery = await request("GET", "/images?section=memory");
  assert.equal(oldGallery.status, 200);
  assert.equal(oldGallery.data.data.images[0].caption, "Old memory");
});


test("email-only registration rejects missing, malformed, and short credentials", async () => {
  for (const body of [
    {}, { email: "voter@example.com" }, { password: "testing-password" },
    { email: {}, password: "testing-password" }, { email: "voter@example.com", password: {} },
    { email: "invalid-email", password: "testing-password" },
    { email: "voter@example.com", password: "short" },
  ]) {
    assert.equal((await request("POST", "/auth/register", body)).status, 400);
  }
  assert.equal(await User.countDocuments(), 0);
  assert.equal(await Credential.countDocuments(), 0);
});


test("Wish Sky gates public viewing and authenticated writing to the Myanmar event date", async () => {
  process.env.WISH_SKY_EVENT_DATE = "2026-10-28";
  try {
    const voter = await register();
    assert.equal((await request("GET", "/wishes/status")).data.data.wishSky.isOpen, false);
    assert.equal((await request("GET", "/wishes")).status, 403);
    assert.equal((await request("POST", "/wishes", { message: "Hello" }, voter.token)).status, 403);
    setTime("2026-10-28T00:00:00+06:30");
    assert.equal((await request("POST", "/wishes", { message: "Hello" })).status, 401);
    assert.equal((await request("POST", "/wishes", { message: "Hello" }, adminToken)).status, 403);
    for (const body of [{}, { message: " " }, { message: 123 }, { message: "a".repeat(501) }, { message: "Hi", user: voter.user.id }]) {
      assert.equal((await request("POST", "/wishes", body, voter.token)).status, 400);
    }
    const submissions = await Promise.all(Array.from({ length: 8 }, (_, i) => request("POST", "/wishes", { message: `Wish ${i}` }, voter.token)));
    assert.equal(submissions.filter((result) => result.status === 201).length, 3);
    assert.equal(submissions.filter((result) => result.status === 409).length, 5);
    assert.equal(await Wish.countDocuments({ user: voter.user.id }), 3);
    const other = await register();
    assert.equal((await request("POST", "/wishes", { message: " Another wish " }, other.token)).status, 201);
    const publicList = await request("GET", "/wishes");
    assert.equal(publicList.status, 200);
    assert.equal(publicList.data.results, 4);
    assert(publicList.data.data.wishes.every((wish) => !wish.user && !wish.slot && !wish.email));
    assert.equal((await request("GET", "/wishes?page=0")).status, 400);
    await User.updateOne({ _id: other.user.id }, { status: "disabled" });
    assert.equal((await request("POST", "/wishes", { message: "Blocked" }, other.token)).status, 403);
    setTime("2026-10-28T23:59:59.999+06:30");
    assert.equal((await request("GET", "/wishes")).status, 200);
    setTime("2026-10-29T00:00:00+06:30");
    assert.equal((await request("GET", "/wishes")).status, 403);
    assert.equal((await request("POST", "/wishes", { message: "Late" }, voter.token)).status, 403);
    process.env.WISH_SKY_EVENT_DATE = "2026-02-30";
    assert.equal((await request("GET", "/wishes")).status, 503);
    delete process.env.WISH_SKY_EVENT_DATE;
    assert.equal((await request("GET", "/wishes")).status, 503);
  } finally { delete process.env.WISH_SKY_EVENT_DATE; }
});

const photoPath = (url) => path.join(testUploadDirectory, url.replace(/^\/uploads\//, ""));
const photoText = async (url) => (await fs.readFile(photoPath(url))).toString();
const photoExists = (url) => fs.access(photoPath(url)).then(() => true, () => false);
const storedPhotos = async () => (await fs.readdir(path.join(testUploadDirectory, "candidates")).catch(() => [])).sort();
// Multipart request with all fields in one JSON "data" value, like the admin page sends.
const sendPhotos = async (method, endpoint, data, files = []) => {
  const form = new FormData();
  form.append("data", JSON.stringify(data));
  files.forEach((content, index) => form.append("images", new Blob([content], { type: "image/png" }), `photo-${index}.png`));
  const response = await fetch(`${base}/api/v1${endpoint}`, { method, headers: { Authorization: `Bearer ${adminToken}` }, body: form });
  return { status: response.status, data: await response.json() };
};

test("candidate photos can be added, replaced in place, reordered and removed; unused files are deleted", async () => {
  const created = await sendPhotos("POST", "/candidates", { fullName: "Photo Editor", category: "king", hobbiesAndInterests: ["chess"] }, ["A"]);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.data.candidate._id;
  const [a] = created.data.data.candidate.images;
  const edit = (data, files) => sendPhotos("PATCH", `/candidates/${id}`, data, files);
  const contents = (images) => Promise.all(images.map(photoText));
  assert.deepEqual(await contents([a]), ["A"]);

  let res = await edit({ photoLayout: [{ keep: a }, { upload: 0 }] }, ["B"]);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  let images = res.data.data.candidate.images;
  assert.deepEqual(await contents(images), ["A", "B"]);
  const b = images[1];

  res = await edit({ photoLayout: [{ keep: a }, { keep: b }, { upload: 0 }] }, ["C"]);
  images = res.data.data.candidate.images;
  assert.deepEqual(await contents(images), ["A", "B", "C"]);
  const c = images[2];

  // Replacing the first photo keeps its position and deletes the old file.
  res = await edit({ photoLayout: [{ upload: 0 }, { keep: b }, { keep: c }] }, ["D"]);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  images = res.data.data.candidate.images;
  assert.deepEqual(await contents(images), ["D", "B", "C"]);
  assert.deepEqual(res.data.data.storageCleanup, { deleted: 1, failed: 0 });
  assert.equal(await photoExists(a), false);
  const d = images[0];

  // Reordering (choosing a cover) and removing need no upload and can be plain JSON.
  res = await request("PATCH", `/candidates/${id}`, { photoLayout: [{ keep: c }, { keep: d }, { keep: b }] }, adminToken);
  assert.deepEqual(res.data.data.candidate.images, [c, d, b]);
  assert.deepEqual(res.data.data.storageCleanup, { deleted: 0, failed: 0 });
  res = await request("PATCH", `/candidates/${id}`, { photoLayout: [{ keep: c }, { keep: b }] }, adminToken);
  assert.deepEqual(res.data.data.candidate.images, [c, b]);
  assert.equal(await photoExists(d), false);
  assert.equal(await photoExists(c), true);
  assert.equal(await photoExists(b), true);

  // Text-only edits leave photos alone, and JSON data keeps an emptied list empty.
  res = await request("PATCH", `/candidates/${id}`, { bio: "Updated" }, adminToken);
  assert.deepEqual(res.data.data.candidate.images, [c, b]);
  res = await edit({ hobbiesAndInterests: [], photoLayout: [{ keep: c }, { keep: b }, { upload: 0 }] }, ["E"]);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.data.candidate.hobbiesAndInterests, []);
  images = res.data.data.candidate.images;
  assert.equal(images.length, 3);

  // Deleting the candidate deletes every photo it had.
  assert.equal((await request("DELETE", `/candidates/${id}`, undefined, adminToken)).status, 204);
  for (const url of images) assert.equal(await photoExists(url), false, url);
});

test("photo edits reject unsafe or inconsistent requests without changing photos or leaving files", async () => {
  const created = await sendPhotos("POST", "/candidates", { fullName: "Strict Photos", category: "queen" }, ["A", "B"]);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const { _id: id, images } = created.data.data.candidate;
  const before = await storedPhotos();
  const cases = [
    [{ bio: "files without a layout" }, ["N"], 400],
    [{ images: ["https://example.com/outside.jpg"] }, [], 400],
    [{ photoLayout: [{ keep: "/uploads/candidates/not-this-candidates.png" }] }, [], 409],
    [{ photoLayout: [{ keep: "https://example.com/outside.jpg" }] }, [], 409],
    [{ photoLayout: [{ keep: images[0] }, { keep: images[0] }] }, [], 400],
    [{ photoLayout: [{ keep: images[0] }, { upload: 1 }] }, ["N"], 400],
    [{ photoLayout: [{ keep: images[0] }] }, ["N"], 400],
    [{ photoLayout: [] }, [], 400],
    [{ photoLayout: [{ keep: images[0] }, { keep: images[1] }, { upload: 0 }, { upload: 1 }] }, ["N", "M"], 400],
    [{ photoLayout: [{ keep: images[0], upload: 0 }] }, ["N"], 400],
    [{ photoLayout: "not json" }, [], 400],
    // Passes every photo check, uploads, then fails validation on save: the upload must be removed.
    [{ fullName: "", photoLayout: [{ keep: images[0] }, { upload: 0 }] }, ["N"], 400],
  ];
  for (const [data, files, status] of cases) {
    const res = await sendPhotos("PATCH", `/candidates/${id}`, data, files);
    assert.equal(res.status, status, `${JSON.stringify(data)} -> ${JSON.stringify(res.data)}`);
  }
  assert.equal((await request("PATCH", `/candidates/${id}`, { images: [images[1]] }, adminToken)).status, 400);
  const badJson = new FormData();
  badJson.append("data", "{not json");
  assert.equal((await fetch(`${base}/api/v1/candidates/${id}`, { method: "PATCH", headers: { Authorization: `Bearer ${adminToken}` }, body: badJson })).status, 400);
  assert.equal((await sendPhotos("POST", "/candidates", { fullName: "X", category: "king", photoLayout: [{ upload: 0 }] }, ["N"])).status, 400);
  assert.equal((await sendPhotos("POST", "/candidates", { fullName: "X", category: "king", images: ["https://example.com/a.jpg"] }, ["N"])).status, 400);

  assert.deepEqual((await request("GET", `/admin/candidates/${id}`, undefined, adminToken)).data.data.candidate.images, images);
  assert.deepEqual(await storedPhotos(), before);
});

test("a photo file still used by another candidate is never deleted", async () => {
  const owner = (await sendPhotos("POST", "/candidates", { fullName: "Owner", category: "king" }, ["A", "B"])).data.data.candidate;
  const shared = owner.images[0];
  const other = await makeCandidate("queen", { images: [shared] });
  const res = await request("PATCH", `/candidates/${owner._id}`, { photoLayout: [{ keep: owner.images[1] }] }, adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(await photoExists(shared), true);
  assert.equal((await request("DELETE", `/candidates/${other._id}`, undefined, adminToken)).status, 204);
  assert.equal(await photoExists(shared), false);
});
