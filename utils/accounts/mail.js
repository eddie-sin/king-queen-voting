const { Mail, Flow, Limit } = require("../../model/studentAuthModels");
const { unseal } = require("./security");
const { hit } = require("./challenges");
const { withControls } = require("../eventControls");
let timer,
  running = false;
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
    ok: response.ok,
    id: data.id,
    status: response.status,
    code: data.name,
    retryAfter: Number(response.headers.get("retry-after")) || 5,
  };
}
exports.tick = async (transport = deliver) => {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    await Mail.updateMany(
      { expiresAt: { $lte: now }, payload: { $exists: true } },
      { $set: { status: "expired" }, $unset: { payload: 1 } },
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
    const job = await Mail.findOneAndUpdate(
      {
        status: { $in: ["pending", "sending"] },
        expiresAt: { $gt: now },
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
        { $set: { status: "cancelled" }, $unset: { payload: 1 } },
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
    let result;
    try {
      result = await transport(unseal(job.payload), job._id);
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
  } finally {
    running = false;
  }
};
exports.start = () => {
  if (timer) return;
  timer = setInterval(
    () =>
      exports
        .tick()
        .catch(() => console.warn("Authentication mail queue unavailable.")),
    1000,
  );
  timer.unref();
};
exports.stop = () => {
  clearInterval(timer);
  timer = null;
};
