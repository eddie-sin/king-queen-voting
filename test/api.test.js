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
  for (const Model of [User, Credential, Candidate, Ballot, Election, Results]) await Model.deleteMany({});
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
  const storedImage = "startup-storage-check.png";
  await fs.writeFile(path.join(testUploadDirectory, storedImage), Buffer.from("local-only"));
  for (const mode of ["development", "production"]) {
    const port = await freePort();
    const child = spawn(process.execPath, ["server.js"], {
      cwd: path.resolve(__dirname, ".."),
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
          assert.equal((await response.json()).data.schedule.timezone, "Asia/Yangon");
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
