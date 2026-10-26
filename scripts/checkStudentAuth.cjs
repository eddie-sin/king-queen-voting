// Disposable replica-set checks. Never loads config.env or contacts Google/Resend.
const assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  mongoose = require("mongoose");
const fs = require("node:fs"),
  path = require("node:path");
const temporaryStorage = fs.mkdtempSync(
  path.join(require("node:os").tmpdir(), "kq-auth-images-"),
);
Object.assign(process.env, {
  NODE_ENV: "production",
  AUTH_ORIGIN: "http://localhost:5173",
  AUTH_OTP_SECRET: crypto.randomBytes(32).toString("hex"),
  AUTH_MAIL_SECRET: crypto.randomBytes(32).toString("hex"),
  JWT_SECRET: crypto.randomBytes(32).toString("hex"),
  GOOGLE_CLIENT_ID_DEVELOPMENT: "isolated-check.apps.googleusercontent.com",
  RESEND_API_KEY: "fake-not-used",
  MEMORY_PHOTO_STORAGE: "local",
  MEMORY_PHOTO_UPLOAD_DIR: temporaryStorage,
});
const app = require("../app"),
  User = require("../model/usersModel"),
  Controls = require("../model/eventControlsModel");
const { Flow, Session, Limit, Mail } = require("../model/studentAuthModels"),
  security = require("../utils/accounts/security"),
  google = require("../utils/accounts/google");
const database = "kqv_auth_check_" + crypto.randomBytes(8).toString("hex");
let server,
  checks = 0;
function client() {
  let cookies = {},
    csrf;
  return {
    async request(
      path,
      body,
      expected = 200,
      extra = {},
      method = body ? "POST" : "GET",
    ) {
      const multipart = body instanceof FormData;
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/v1` + path,
        {
          method,
          headers: {
            Cookie: Object.entries(cookies)
              .map(([k, v]) => `${k}=${v}`)
              .join("; "),
            Origin: process.env.AUTH_ORIGIN,
            ...(!multipart ? { "Content-Type": "application/json" } : {}),
            ...(csrf ? { "X-CSRF-Token": csrf } : {}),
            ...extra,
          },
          ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
        },
      );
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(";")[0].split("=");
        cookies[pair[0]] = pair[1];
      }
      const json = await response.json();
      assert.equal(response.status, expected, `${path}: ${json.message || ""}`);
      checks++;
      if (json.data?.csrfToken) csrf = json.data.csrfToken;
      return json.data;
    },
    async init() {
      return this.request("/auth/config");
    },
    cookies: () => cookies,
  };
}
const op = () => crypto.randomUUID();
async function code(flow) {
  return security
    .unseal((await Mail.findById(flow.flowId).select("+payload")).payload)
    .text.match(/code is (\d{6})/)[1];
}
async function cooldown(email) {
  await Limit.deleteMany({
    _id: {
      $in: [
        `recipient:${email}`,
        `recipient-day:${new Date().toISOString().slice(0, 10)}:${email}`,
      ],
    },
  });
}
(async () => {
  await mongoose.connect(
    process.env.AUTH_TEST_MONGO_URI.replace("/?", `/${database}?`),
    { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 3000 },
  );
  try {
    for (const model of Object.values(mongoose.models)) {
      await model.createCollection();
      await model.createIndexes();
    }
    await Controls.create({ _id: "event", registrationOpen: true });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const a = client(),
      b = client();
    await a.init();
    await b.init();
    await a.request(
      "/auth/register/start",
      { email: "x@example.com", password: "password123", operationId: op() },
      400,
    );
    const body = {
      email: "Ed.Die+test@gmail.com",
      password: "password123",
      operationId: op(),
    };
    const f = await a.request("/auth/register/start", body);
    assert.equal(await User.countDocuments(), 0);
    const again = await a.request("/auth/register/start", body);
    assert.equal(again.flowId, f.flowId);
    assert.equal(await Mail.countDocuments(), 1);
    await a.request(
      "/auth/register/start",
      { ...body, operationId: op() },
      429,
    );
    await b.request(
      "/auth/register/verify",
      { flowId: f.flowId, code: await code(f) },
      400,
    );
    await a.request(
      "/auth/register/verify",
      { flowId: f.flowId, code: "invalid" },
      400,
    );
    assert.equal((await Flow.findById(f.flowId)).attempts, 1);
    await Controls.updateOne(
      { _id: "event" },
      { $set: { registrationOpen: false } },
    );
    await a.request(
      "/auth/register/verify",
      { flowId: f.flowId, code: await code(f) },
      403,
    );
    await Controls.updateOne(
      { _id: "event" },
      { $set: { registrationOpen: true } },
    );
    const signed = await a.request("/auth/register/verify", {
      flowId: f.flowId,
      code: await code(f),
    });
    const uid = signed.user.id;
    assert.equal((await User.findById(uid)).emailKey, "eddie@gmail.com");
    await a.request("/auth/me");
    await a.request("/wishes", { message: "A cookie-authenticated wish" }, 201);
    assert.equal((await a.request("/wishes/mine")).used, 1);
    await b.request("/wishes", { message: "Unauthenticated" }, 401);
    await Controls.updateOne(
      { _id: "event" },
      { $set: { memoryPhotosEnabled: true } },
    );
    const png = await require("sharp")({
      create: { width: 8, height: 8, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const upload = () => {
      const form = new FormData();
      form.append(
        "images",
        new Blob([png], { type: "image/png" }),
        "memory.png",
      );
      return form;
    };
    await a.request("/memory-photos", upload(), 403, {
      "X-CSRF-Token": "wrong",
    });
    const submitted = await a.request("/memory-photos", upload(), 201);
    assert.equal(submitted.photo.status, "PENDING");
    assert.equal((await a.request("/memory-photos/mine")).photos.length, 1);
    await require("../model/memoryPhotosModel").updateOne(
      { _id: submitted.photo.id },
      { $set: { status: "APPROVED" } },
    );
    const likePath = `/memory-photos/${submitted.photo.id}/like`;
    assert.equal((await a.request(likePath, {})).liked, true);
    assert.equal(
      (await a.request(likePath, null, 200, {}, "DELETE")).liked,
      false,
    );
    await a.request(
      "/auth/register/verify",
      { flowId: f.flowId, code: "000000" },
      400,
    );
    await a.request("/auth/logout", {}, 403, {
      Origin: "https://evil.eddiespace.com",
    });
    await a.request("/auth/logout", {});
    await a.request("/auth/me", null, 401);
    await a.request("/auth/login", {
      email: "eddie@gmail.com",
      password: "password123",
    });
    await a.request("/auth/me");
    await a.request(
      "/auth/login",
      { email: "eddie@gmail.com", password: "wrongpassword" },
      401,
    );
    await b.request("/auth/me", null, 401, {
      Authorization: "Bearer " + signed.sessionKey,
    });
    await cooldown("eddie@gmail.com");
    let start = await a.request("/auth/google/start", {});
    const original = google.verify;
    await a.request(
      "/auth/google/complete",
      { flowId: start.flowId, credential: "invalid", operationId: op() },
      401,
    );
    google.verify = async () => ({
      email: "eddie@gmail.com",
      emailKey: "eddie@gmail.com",
      sub: "google-eddie",
      nonce: start.nonce,
    });
    const link = await a.request("/auth/google/complete", {
      flowId: start.flowId,
      credential: "fake",
      operationId: op(),
    });
    assert.equal(link.purpose, "link");
    assert.equal(await User.countDocuments(), 1);
    const linked = await a.request("/auth/google/link/verify", {
      flowId: link.flowId,
      code: await code(link),
    });
    assert.equal(linked.user.id, uid);
    await a.request("/auth/me");
    assert.equal((await a.request("/wishes/mine")).used,1);
    await a.request(
      "/auth/google/link/verify",
      { flowId: link.flowId, code: "000000" },
      400,
    );
    start = await b.request("/auth/google/start", {});
    await Controls.updateOne(
      { _id: "event" },
      { $set: { registrationOpen: false } },
    );
    const returning = await b.request("/auth/google/complete", {
      flowId: start.flowId,
      credential: "fake",
      operationId: op(),
    });
    assert.equal(returning.user.id, uid);
    await b.request(
      "/auth/google/complete",
      { flowId: start.flowId, credential: "fake", operationId: op() },
      401,
    );
    await cooldown("eddie@gmail.com");
    const recover = await a.request("/auth/password/recovery/start", {
      email: "ed.die+hello@gmail.com",
      operationId: op(),
    });
    const grant = await a.request("/auth/password/recovery/verify", {
      flowId: recover.flowId,
      code: await code(recover),
    });
    await b.request(
      "/auth/password/recovery/complete",
      { resetId: grant.resetId, password: "newpassword123" },
      400,
    );
    await a.request("/auth/password/recovery/complete", {
      resetId: grant.resetId,
      password: "newpassword123",
    });
    await b.request("/auth/me", null, 401);
    await a.request(
      "/auth/login",
      { email: "eddie@gmail.com", password: "password123" },
      401,
    );
    await a.request("/auth/login", {
      email: "eddie@gmail.com",
      password: "newpassword123",
    });
    await Controls.updateOne(
      { _id: "event" },
      { $set: { registrationOpen: true } },
    );
    start = await a.request("/auth/google/start", {});
    google.verify = async () => ({
      email: "second@gmail.com",
      emailKey: "second@gmail.com",
      sub: "google-second",
      nonce: start.nonce,
    });
    const pending = await b.request("/auth/register/start", {
      email: "second@gmail.com",
      password: "attacker-password",
      operationId: op(),
    });
    const second = await a.request("/auth/google/complete", {
      flowId: start.flowId,
      credential: "fake",
      operationId: op(),
    });
    assert.equal(await User.countDocuments(), 2);
    assert.equal(
      (await User.findById(second.user.id).select("+passwordHash"))
        .passwordHash,
      undefined,
    );
    await b.request(
      "/auth/register/verify",
      { flowId: pending.flowId, code: await code(pending) },
      400,
    );
    // Google-only accounts add a password through ownership-proven recovery.
    await cooldown("second@gmail.com");
    const addPassword = await a.request("/auth/password/recovery/start",{email:"second@gmail.com",operationId:op()});
    const addGrant = await a.request("/auth/password/recovery/verify",{flowId:addPassword.flowId,code:await code(addPassword)});
    await a.request("/auth/password/recovery/complete",{resetId:addGrant.resetId,password:"google-added-password123"});
    const addedLogin=await a.request("/auth/login",{email:"second@gmail.com",password:"google-added-password123"});
    assert.equal(addedLogin.user.id,second.user.id);
    await User.updateOne(
      { _id: second.user.id },
      { $set: { status: "disabled" } },
    );
    await a.request("/auth/me", null, 401);
    google.verify = original;
    // Queued delivery: repeat ticks do not duplicate, payload deleted on confirmed send.
    let sends = 0;
    const queued = await Mail.findOne({ flow: recover.flowId });
    const transport = async () => {
      sends++;
      return { ok: true, id: "fake-id" };
    };
    for (let i = 0; i < 10; i++)
      await require("../utils/accounts/mail").tick(transport);
    assert.ok(sends <= (await Mail.countDocuments()));
    assert.equal(
      await Mail.countDocuments({ status: "sent", payload: { $exists: true } }),
      0,
    );
    // Quota refusal never grants a session or admits an extra job.
    const day = new Date().toISOString().slice(0, 10);
    await Limit.updateOne(
      { _id: `mail-day:${day}` },
      { $set: { count: 100, until: new Date(Date.now() + 3600000) } },
      { upsert: true },
    );
    const before = await Mail.countDocuments();
    await b.request(
      "/auth/register/start",
      { email: "third@gmail.com", password: "password123", operationId: op() },
      429,
    );
    assert.equal(await Mail.countDocuments(), before);
    // CSRF, expired session, and no provider credentials accepted from clients.
    await b.request(
      "/auth/login",
      { email: "eddie@gmail.com", password: "newpassword123" },
      403,
      { "X-CSRF-Token": "wrong" },
    );
    await b.request(
      "/auth/login",
      { email: "eddie@gmail.com", password: "newpassword123", role: "admin" },
      400,
    );
    assert.equal(await User.countDocuments(), 2);

    // Wrong/expired code consumption and durable resend replacement.
    await Limit.deleteMany({});
    const c = client();
    await c.init();
    const exp = await c.request("/auth/register/start", {
      email: "expire@gmail.com",
      password: "password123",
      operationId: op(),
    });
    for (let n = 0; n < 5; n++)
      await c.request(
        "/auth/register/verify",
        { flowId: exp.flowId, code: "invalid" },
        400,
      );
    await c.request(
      "/auth/register/verify",
      { flowId: exp.flowId, code: await code(exp) },
      400,
    );
    await cooldown("expire@gmail.com");
    const resendOperation = {
      flowId: exp.flowId,
      operationId: op(),
    };
    const replacement = await c.request("/auth/otp/resend", resendOperation);
    const replacementAgain = await c.request(
      "/auth/otp/resend",
      resendOperation,
    );
    assert.equal(replacementAgain.flowId, replacement.flowId);
    await c.request(
      "/auth/register/verify",
      { flowId: exp.flowId, code: await code(exp) },
      400,
    );
    await Flow.updateOne(
      { _id: replacement.flowId },
      { $set: { expiresAt: new Date(0) } },
    );
    await c.request(
      "/auth/register/verify",
      { flowId: replacement.flowId, code: await code(replacement) },
      400,
    );
    // Thirty independent browsers sharing an IP can start registration. No real mail is sent.
    await Limit.deleteMany({});
    const burstStarted = performance.now();
    const durations=[];
    const batch = await Promise.all(
      Array.from({ length: 30 }, async (_, n) => {
        const peer = client();
        await peer.init();
        const started=performance.now();
        const result = await peer.request("/auth/register/start", {
          email: `burst${n}@gmail.com`,
          password: "password123",
          operationId: op(),
        });
        durations.push(performance.now()-started);return result;
      }),
    );
    assert.equal(new Set(batch.map((f) => f.flowId)).size, 30);
    durations.sort((a,b)=>a-b);
    console.log(`Shared-IP signup burst: ${batch.length}/30 accepted, 0 unexpected refusals; total ${Math.round(performance.now()-burstStarted)}ms, p50 ${Math.round(durations[14])}ms, p95 ${Math.round(durations[28])}ms. Fake mail only.`);
    assert.equal((await Limit.findById(`mail-signup:${day}`)).count, 30);
    const loadHash=await require("../utils/passwords").hash("shared-ip-password123");
    await User.create(Array.from({length:10},(_,n)=>({email:`signinburst${n}@gmail.com`,emailKey:`signinburst${n}@gmail.com`,emailVerifiedAt:new Date(),passwordHash:loadHash})));
    for(const kind of ["login","recovery"]){
      const began=performance.now(),times=[];
      await Promise.all(Array.from({length:10},async(_,n)=>{
        const peer=client();await peer.init();const started=performance.now();
        if(kind==="login")await peer.request("/auth/login",{email:`signinburst${n}@gmail.com`,password:"shared-ip-password123"});
        else await peer.request("/auth/password/recovery/start",{email:`signinburst${n}@gmail.com`,operationId:op()});
        times.push(performance.now()-started);
      }));times.sort((a,b)=>a-b);
      console.log(`Shared-IP ${kind} burst: 10/10 accepted, 0 unexpected refusals; total ${Math.round(performance.now()-began)}ms, p50 ${Math.round(times[4])}ms, p95 ${Math.round(times[9])}ms. Fake mail only.`);
    }
    await c.request("/auth/register/start", {
      email: "queuefailure@gmail.com",
      password: "password123",
      operationId: op(),
    });
    // A prior-day queued message cannot bypass the new day's reserved allowance.
    const carry = await Mail.findById(batch[0].flowId);
    await Mail.updateOne(
      { _id: carry._id },
      { $set: { budgetDay: "2000-01-01", nextAt: new Date(0) } },
    );
    const reservedToday = (await Limit.findById(`mail-day:${day}`)).count;
    await Limit.updateOne({ _id: `mail-day:${day}` }, { $set: { count: 100 } });
    let carrySends = 0;
    await require("../utils/accounts/mail").tick(async () => {
      carrySends++;
      return { ok: true, id: "unexpected" };
    });
    assert.equal(carrySends, 0);
    assert.equal((await Mail.findById(carry._id)).status, "failed");
    await Limit.updateOne(
      { _id: `mail-day:${day}` },
      { $set: { count: reservedToday } },
    );
    const retriedCarry = batch[1].flowId;
    await Mail.updateOne(
      { _id: retriedCarry },
      {
        $set: {
          budgetDay: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
          nextAt: new Date(0),
        },
      },
    );
    const retryIds = [];
    await require("../utils/accounts/mail").tick(async (_payload, id) => {
      retryIds.push(id);
      return { ok: false, status: 503, retryAfter: 1 };
    });
    await Mail.updateOne(
      { _id: retriedCarry },
      { $set: { nextAt: new Date(0) } },
    );
    await require("../utils/accounts/mail").tick(async (_payload, id) => {
      retryIds.push(id);
      return { ok: true, id: "carry-retry-success" };
    });
    assert.deepEqual(retryIds, [retriedCarry, retriedCarry]);
    assert.equal(
      (await Limit.findById(`mail-day:${day}`)).count,
      reservedToday + 1,
    );
    assert.equal((await Mail.findById(retriedCarry)).status, "sent");
    let quotaSends = 0;
    const quotaTransport = async () => {
      quotaSends++;
      return { ok: false, status: 429, code: "daily_quota_exceeded" };
    };
    for (let n = 0; n < 10 && !quotaSends; n++)
      await require("../utils/accounts/mail").tick(quotaTransport);
    await require("../utils/accounts/mail").tick(quotaTransport);
    assert.equal(quotaSends, 1);
    assert.equal(
      await Mail.countDocuments({
        status: "failed",
        payload: { $exists: true },
      }),
      0,
    );
    const failed = await c.request("/auth/pending");
    assert.equal(failed.delivery, "failed");
    assert.match(failed.deliveryMessage, /allowance/);
    await Limit.updateOne({_id:`password-attempt:${security.digest("eddie@gmail.com")}`},{$set:{count:20,until:new Date(Date.now()+900000)}},{upsert:true});
    await a.request("/auth/login",{email:"ed.die+alias@gmail.com",password:"newpassword123"},429);
    // Returning Google identity still signs in during email/quota exhaustion.
    start = await a.request("/auth/google/start",{});
    google.verify = async()=>({email:"eddie@gmail.com",emailKey:"eddie@gmail.com",sub:"google-eddie",nonce:start.nonce});
    await a.request("/auth/google/complete",{flowId:start.flowId,credential:"fake",operationId:op()});
    google.verify = original;
    // Expired session denied even before TTL cleanup.
    await Session.updateMany({}, { $set: { expiresAt: new Date(0) } });
    await a.request("/auth/me", null, 401);
    console.log(
      `Student authentication checks passed: ${checks} HTTP assertions plus identity, OTP, session, queue and quota checks.`,
    );
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await fs.promises.rm(temporaryStorage, { recursive: true, force: true });
  }
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
