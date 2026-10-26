const { Mail, Flow, Limit } = require("../../model/studentAuthModels");
const { unseal } = require("./security");
const { hit } = require("./challenges");
const { withControls } = require("../eventControls");
let timer,
  running = null;
let stopped = false;
async function deliver(payload, id) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `kq-auth/${id}`,
    },
    body: JSON.stringify(payload),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return {
    ok: response.ok && typeof data.id === "string",
    id: data.id,
    status: response.ok && typeof data.id !== "string" ? 503 : response.status,
    code: data.name,
    retryAfter: Number(response.headers.get("retry-after")) || 5,
  };
}
async function tick(transport) {
  const now = new Date();
  await Mail.updateMany(
    { expiresAt: { $lte: now }, payload: { $exists: true } },
    { $set: { status: "expired" }, $unset: { payload: 1, leaseUntil: 1 } },
  );
  const pause = await Limit.findById("mail-pause");
  if (pause?.until > now) {
    await Mail.updateMany(
      { status: { $in: ["pending", "sending"] } },
      {
        $set: { status: "failed", errorCode: "quota" },
        $unset: { payload: 1, leaseUntil: 1 },
      },
    );
    return;
  }
  await Mail.updateMany({status:{$in:["pending","sending"]},attempts:{$gte:4},$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lte:now}}]}, {
    $set:{status:"failed",errorCode:"attempts"},$unset:{payload:1,leaseUntil:1},
  });
  const job = await Mail.findOneAndUpdate(
    {
      status: { $in: ["pending", "sending"] },
      expiresAt: { $gt: now },
      attempts: { $lt: 4 },
      nextAt: { $lte: now },
      $or: [
        { leaseUntil: { $exists: false } },
        { leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: { status: "sending", leaseUntil: new Date(Date.now() + 30000) },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after", sort: { nextAt: 1 } },
  ).select("+payload");
  if (!job) return;
  const flow = await Flow.findOne({
    _id: job.flow,
    consumed: false,
    expiresAt: { $gt: now },
  }).select("createdAt purpose");
  if (!flow) {
    await Mail.updateOne(
      { _id: job._id },
      { $set: { status: "cancelled" }, $unset: { payload: 1, leaseUntil: 1 } },
    );
    return;
  }
  // A queued email crossing UTC midnight must reserve the new day's capacity.
  const day = now.toISOString().slice(0, 10);
  if ((job.budgetDay || flow.createdAt.toISOString().slice(0, 10)) !== day) {
    try {
      await withControls(async ({ session }) => {
        const current = await Mail.findById(job._id).session(session);
        if (current.budgetDay === day) return;
        const end = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + 1,
          ),
        );
        await hit(`mail-day:${day}`, 100, end, session);
        if (flow.purpose === "register")
          await hit(`mail-signup:${day}`, 80, end, session);
        const previousDay =
          current.budgetDay || flow.createdAt.toISOString().slice(0, 10);
        if (previousDay.slice(0, 7) !== day.slice(0, 7))
          await hit(
            `mail-month:${day.slice(0, 7)}`,
            3000,
            new Date(
              Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
            ),
            session,
          );
        await Mail.updateOne(
          { _id: job._id },
          { $set: { budgetDay: day } },
          { session },
        );
      });
    } catch (error) {
      if (error.statusCode !== 429) throw error;
      await Mail.updateOne(
        { _id: job._id },
        {
          $set: { status: "failed", errorCode: "quota" },
          $unset: { payload: 1, leaseUntil: 1 },
        },
      );
      return;
    }
  }
  let payload;
  try { payload = unseal(job.payload); }
  catch {
    await Mail.updateOne({ _id: job._id }, {
      $set: { status: "failed", errorCode: "payload" },
      $unset: { payload: 1, leaseUntil: 1 },
    });
    console.warn("Authentication email payload unavailable.");
    return;
  }
  let result;
  try {
    result = await transport(payload, job._id);
  } catch {
    result = { ok: false, status: 503, code: "interrupted", retryAfter: 5 };
  }
  if (result.ok) {
    await Mail.updateOne(
      { _id: job._id },
      {
        $set: { status: "sent", providerId: result.id },
        $unset: { payload: 1, leaseUntil: 1 },
      },
    );
    return;
  }
  const quota = ["daily_quota_exceeded", "monthly_quota_exceeded"].includes(
    result.code,
  );
  if (quota) {
    const until =
      result.code === "monthly_quota_exceeded"
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
        : new Date(
            Date.UTC(
              now.getUTCFullYear(),
              now.getUTCMonth(),
              now.getUTCDate() + 1,
            ),
          );
    await Limit.updateOne(
      { _id: "mail-pause" },
      { $set: { until, count: 1 } },
      { upsert: true },
    );
    await Mail.updateMany(
      { status: { $in: ["pending", "sending"] } },
      {
        $set: { status: "failed", errorCode: "quota" },
        $unset: { payload: 1, leaseUntil: 1 },
      },
    );
  }
  const retry =
    !quota &&
    (result.status === 429 || result.status >= 500) &&
    job.attempts < 4;
  await Mail.updateOne(
    { _id: job._id },
    {
      $set: {
        status: retry ? "pending" : "failed",
        errorCode: quota ? "quota" : String(result.status),
        nextAt: new Date(
          Date.now() +
            Math.min(60, Math.max(5, result.retryAfter || 5) * job.attempts) *
              1000,
        ),
      },
      $unset: { leaseUntil: 1, ...(!retry ? { payload: 1 } : {}) },
    },
  );
  console.warn(
    "Authentication email delivery:",
    quota ? "quota reached" : retry ? "retry scheduled" : "failed",
  );
}
exports.tick = (transport = deliver) => {
  if (running || stopped) return running || Promise.resolve();
  // Tests may never fall through to the real provider, even by accident.
  if (transport === deliver && (process.env.NODE_ENV === "test" || process.env.AUTH_TEST_MODE === "true"))
    return Promise.reject(new Error("Real email transport is disabled during tests."));
  running = tick(transport).finally(() => { running = null; });
  return running;
};
exports.start = () => {
  if (timer) return;
  stopped = false;
  timer = setInterval(
    () =>
      exports
        .tick()
        .catch(() => console.warn("Authentication mail queue unavailable.")),
    1000,
  );
  timer.unref();
};
exports.stop = async () => {
  stopped = true;
  clearInterval(timer);
  timer = null;
  await running;
};
