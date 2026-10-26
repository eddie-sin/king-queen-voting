const crypto = require("node:crypto");
const { Flow, Limit, Mail } = require("../../model/studentAuthModels");
const security = require("./security");
const AppError = require("../appError");
const { settings } = require("./config");
exports.hit = async (id, max, until, session) => {
  let limit = await Limit.findById(id).session(session);
  if (!limit) limit = new Limit({ _id: id, count: 0, until });
  if (limit.until <= new Date()) {
    limit.count = 0;
    limit.until = until;
  }
  if (limit.count >= max)
    throw new AppError(
      "Too many requests or email allowance reached. Try later; Google sign-in may still be available.",
      429,
    );
  limit.count++;
  limit.last = new Date();
  await limit.save({ session });
};
exports.operationKey = (browser, purpose, operationId) => {
  if (typeof operationId !== "string" || !/^[a-f0-9-]{36}$/i.test(operationId))
    throw new AppError("A fresh request identifier is required.", 400);
  return security.digest(`${browser}:${purpose}:${operationId}`);
};
exports.admit = async (
  {
    browser,
    purpose,
    email,
    emailKey,
    user,
    version,
    passwordHash,
    googleSub,
    proofExpiresAt,
    operationId,
  },
  session,
) => {
  const id = exports.operationKey(browser, purpose, operationId);
  const previous = await Flow.findById(id).session(session);
  if (previous) {
    if (previous.emailKey !== emailKey)
      throw new AppError("Start a fresh request for this Gmail address.", 409);
    return previous;
  }
  const now = new Date(),
    day = now.toISOString().slice(0, 10),
    month = day.slice(0, 7);
  const end = new Date(`${day}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const last = await Limit.findById(`recipient:${emailKey}`).session(session);
  if (last?.last && Date.now() - last.last.getTime() < 60000)
    throw new AppError(
      "Wait at least 60 seconds before requesting another email.",
      429,
    );
  await exports.hit(
    `recipient:${emailKey}`,
    3,
    new Date(Date.now() + 3600000),
    session,
  );
  await exports.hit(`recipient-day:${day}:${emailKey}`, 5, end, session);
  await exports.hit(
    `browser-hour:${browser}`,
    10,
    new Date(Date.now() + 3600000),
    session,
  );
  await exports.hit(`mail-day:${day}`, 100, end, session);
  if (purpose === "register")
    await exports.hit(`mail-signup:${day}`, 80, end, session);
  await exports.hit(
    `mail-month:${month}`,
    3000,
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    session,
  );
  const pause = await Limit.findById("mail-pause").session(session);
  if (pause?.until > now)
    throw new AppError(
      "Email delivery is temporarily unavailable. Try later.",
      503,
    );
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await Flow.updateMany(
    { emailKey, purpose, consumed: false },
    { $set: { consumed: true } },
    { session },
  );
  const flow = (
    await Flow.create(
      [
        {
          _id: id,
          browser,
          purpose,
          email,
          emailKey,
          user,
          version,
          passwordHash,
          googleSub,
          otp: security.mac(`${id}:${code}`),
          proofExpiresAt:
            purpose === "link"
              ? proofExpiresAt || new Date(Date.now() + 600000)
              : undefined,
          expiresAt:
            purpose === "link" && proofExpiresAt
              ? new Date(
                  Math.min(
                    new Date(proofExpiresAt).getTime(),
                    Date.now() + 600000,
                  ),
                )
              : new Date(Date.now() + 600000),
        },
      ],
      { session },
    )
  )[0];
  const payload = {
    from: settings().from,
    to: [email],
    subject: `Your Thadingyut ${purpose === "link" ? "account linking" : purpose === "recovery" ? "password recovery" : "registration"} code`,
    text: `Your code is ${code}.\n\nIt expires in 10 minutes and can only be used for this ${purpose === "link" ? "Google account linking" : purpose === "recovery" ? "password recovery" : "registration"} request. Use the latest code you requested. Never share it. If you did not request this, ignore this email.`,
  };
  await Mail.create(
    [
      {
        _id: id,
        flow: id,
        payload: security.seal(payload),
        budgetDay: day,
        expiresAt: flow.expiresAt,
      },
    ],
    { session },
  );
  return flow;
};
exports.summary = (flow) => ({
  flowId: flow._id,
  purpose: flow.purpose,
  email: flow.email.replace(/^(.{1,2}).*(@.*)$/, "$1***$2"),
  expiresAt: flow.expiresAt,
  resendAt: new Date(flow.createdAt.getTime() + 60000),
  message:
    "If this request is eligible, an email will arrive shortly. Use the latest code. Existing accounts should sign in or recover their password.",
});
// Invalid attempts are returned, not thrown, so the transaction commits the attempt counter.
exports.check = async (req, purpose, session) => {
  const id = req.body.flowId;
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
    return { failure: "Invalid or expired request. Start again." };
  const flow = await Flow.findOne({
    _id: id,
    browser: req.authBrowser,
    purpose,
    consumed: false,
    expiresAt: { $gt: new Date() },
  })
    .select("+otp +passwordHash")
    .session(session);
  if (!flow) return { failure: "Invalid or expired request. Start again." };
  await exports.hit(
    `verify:${flow.emailKey}`,
    20,
    new Date(Date.now() + 3600000),
    session,
  );
  if (flow.attempts >= 5)
    return { failure: "Too many incorrect codes. Request a new code." };
  flow.attempts++;
  if (
    typeof req.body.code !== "string" ||
    !/^\d{6}$/.test(req.body.code) ||
    !security.equal(flow.otp, security.mac(`${id}:${req.body.code}`))
  ) {
    await flow.save({ session });
    return { failure: "Incorrect or expired code." };
  }
  return { flow };
};
