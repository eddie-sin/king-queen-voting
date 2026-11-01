const User = require("../model/usersModel");
const Ballot = require("../model/ballotsModel");
const { Flow, Session, Mail } = require("../model/studentAuthModels");
const security = require("../utils/accounts/security");
const challenges = require("../utils/accounts/challenges");
const { gmail, settings } = require("../utils/accounts/config");
const google = require("../utils/accounts/google");
const passwords = require("../utils/passwords");
const { transaction } = require('../utils/transactions');
const { withControls, getControls } = require("../utils/eventControls");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");
const active = (user) => {
  if (!user || user.status !== "active" || !user.emailVerifiedAt)
    throw new AppError(
      "This account is unavailable. Sign in again or contact the organisers.",
      403,
    );
};
const only = (req, fields) => {
  if (
    !req.body ||
    typeof req.body !== "object" ||
    Array.isArray(req.body) ||
    Object.keys(req.body).some((k) => !fields.includes(k))
  )
    throw new AppError("Unexpected account fields.", 400);
};
async function profile(user) {
  const c = await getControls();
  const votes = await Ballot.find({ user: user._id, round: c.round })
    .select("contest")
    .lean();
  return {
    id: String(user._id),
    email: user.email,
    round: c.round,
    hasVotedKing: votes.some((v) => v.contest === "king"),
    hasVotedQueen: votes.some((v) => v.contest === "queen"),
  };
}
async function signed(res, user, raw) {
  security.setSession(res, raw);
  res.json({
    status: "success",
    data: { sessionKey: security.digest(raw), user: await profile(user) },
  });
}
const response = (res, flow) =>
  res.json({ status: "success", data: challenges.summary(flow) });
async function inert(req, purpose, identity, session) {
  const id = challenges.operationKey(
    req.authBrowser,
    purpose,
    req.body.operationId,
  );
  return (
    (await Flow.findById(id).session(session)) ||
    (
      await Flow.create(
        [
          {
            _id: id,
            browser: req.authBrowser,
            purpose,
            ...identity,
            consumed: true,
            expiresAt: new Date(Date.now() + 600000),
          },
        ],
        { session },
      )
    )[0]
  );
}
let dummyHash;
exports.config = catchAsync(async (req, res) => {
  const browser = security.browser(req, res, true);
  res.json({
    status: "success",
    data: {
      csrfToken: security.csrf(browser),
      // A short cache lifetime also recovers from another tab replacing the browser cookie.
      refreshAfter: 60000,
      googleClientId: settings().clientId || null,
    },
  });
});
exports.register = catchAsync(async (req, res) => {
  only(req, ["email", "password", "operationId"]);
  const identity = gmail(req.body.email);
  passwords.validatePassword(req.body.password);
  if (!(await getControls()).registrationOpen)
    throw new AppError("Registration is closed.", 403);
  const passwordHash = await passwords.hash(req.body.password);
  const flow = await withControls(async ({ session, controls }) => {
    if (!controls.registrationOpen)
      throw new AppError("Registration is closed.", 403);
    if (await User.exists({ emailKey: identity.emailKey }).session(session))
      return inert(req, "register", identity, session);
    return challenges.admit(
      {
        browser: req.authBrowser,
        purpose: "register",
        ...identity,
        passwordHash,
        operationId: req.body.operationId,
      },
      session,
    );
  });
  response(res, flow);
});
exports.login = catchAsync(async (req, res) => {
  only(req, ["email", "password"]);
  const { emailKey } = gmail(req.body.email);
  const attemptKey = `password-attempt:${security.digest(`${emailKey}:${req.ip}`)}`;
  // Inbox-scoped and durable across restarts; shared Wi-Fi is not a single account.
  await transaction(async session => {
    await challenges.hit(attemptKey, 20, new Date(Date.now()+15*60000), session);
    await challenges.hit(`password-account:${security.digest(emailKey)}`, 300, new Date(Date.now()+15*60000), session);
  });
  const user = await User.findOne({ emailKey }).select("+passwordHash");
  dummyHash ||= passwords.hash("unused-login-placeholder").catch((error) => {
    dummyHash = null;
    throw error;
  });
  const dummy = await dummyHash;
  const valid =
    typeof req.body.password === "string" &&
    Buffer.byteLength(req.body.password) <= 72 &&
    (await passwords.compare(req.body.password, user?.passwordHash || dummy));
  if (!valid || !user?.passwordHash)
    throw new AppError(
      "Invalid email or password. You may also use Google or password recovery.",
      401,
    );
  const result = await transaction(async session => {
    const current = await User.findOne({
      _id: user._id,
      tokenVersion: user.tokenVersion,
    }).session(session);
    active(current);
    await require("../model/studentAuthModels").Limit.deleteOne({_id:attemptKey}, {session});
    return { user: current, raw: await security.issue(current, session) };
  });
  await signed(res, result.user, result.raw);
});
exports.googleStart = catchAsync(async (req, res) => {
  only(req, []);
  if (!settings().clientId)
    throw new AppError("Google sign-in is unavailable.", 503);
  const nonce = security.random(),
    id = security.random();
  await Flow.create({
    _id: id,
    browser: req.authBrowser,
    purpose: "google",
    nonce: security.digest(nonce),
    expiresAt: new Date(Date.now() + 600000),
  });
  res.json({ status: "success", data: { flowId: id, nonce } });
});
exports.googleComplete = catchAsync(async (req, res) => {
  only(req, ["flowId", "credential", "operationId"]);
  if (
    typeof req.body.flowId !== "string" ||
    !/^[a-f0-9]{64}$/.test(req.body.flowId)
  )
    throw new AppError("Invalid sign-in request.", 400);
  const identity = await google.verify(req.body.credential);
  const result = await withControls(async ({ session, controls }) => {
    const flow = await Flow.findOne({
      _id: req.body.flowId,
      browser: req.authBrowser,
      purpose: "google",
      consumed: false,
      expiresAt: { $gt: new Date() },
    }).session(session);
    if (!flow || !security.equal(flow.nonce, security.digest(identity.nonce)))
      throw new AppError("Google sign-in expired. Start again.", 401);
    flow.consumed = true;
    await flow.save({ session });
    let user = await User.findOne({ googleSub: identity.sub })
      .select("+googleSub")
      .session(session);
    if (user) {
      active(user);
      if (user.emailKey !== identity.emailKey)
        throw new AppError(
          "Google account identity changed. Contact the organisers.",
          409,
        );
      return { user, raw: await security.issue(user, session) };
    }
    user = await User.findOne({ emailKey: identity.emailKey })
      .select("+googleSub")
      .session(session);
    if (user) {
      active(user);
      if (user.googleSub)
        throw new AppError(
          "This account is linked to another Google identity.",
          409,
        );
      return {
        flow: await challenges.admit(
          {
            browser: req.authBrowser,
            purpose: "link",
            email: user.email,
            emailKey: user.emailKey,
            user: user._id,
            version: user.tokenVersion,
            googleSub: identity.sub,
            operationId: req.body.operationId,
          },
          session,
        ),
      };
    }
    if (!controls.registrationOpen)
      throw new AppError(
        "Registration is closed. Existing accounts can still sign in.",
        403,
      );
    user = (
      await User.create(
        [
          {
            email: identity.email,
            emailKey: identity.emailKey,
            googleSub: identity.sub,
            emailVerifiedAt: new Date(),
          },
        ],
        { session },
      )
    )[0];
    await Flow.updateMany(
      { emailKey: identity.emailKey, purpose: "register", consumed: false },
      { $set: { consumed: true } },
      { session },
    );
    return { user, raw: await security.issue(user, session) };
  });
  if (result.flow) return response(res, result.flow);
  await signed(res, result.user, result.raw);
});
exports.verifyRegistration = catchAsync(async (req, res) => {
  only(req, ["flowId", "code"]);
  const result = await withControls(async ({ session, controls }) => {
    const checked = await challenges.check(req, "register", session);
    if (checked.failure) return checked;
    if (!controls.registrationOpen)
      throw new AppError("Registration is closed.", 403);
    const { flow } = checked;
    if (await User.exists({ emailKey: flow.emailKey }).session(session))
      throw new AppError(
        "An account already exists. Sign in or recover its password.",
        409,
      );
    const user = (
      await User.create(
        [
          {
            email: flow.email,
            emailKey: flow.emailKey,
            passwordHash: flow.passwordHash,
            emailVerifiedAt: new Date(),
          },
        ],
        { session },
      )
    )[0];
    flow.consumed = true;
    await flow.save({ session });
    return { user, raw: await security.issue(user, session) };
  });
  if (result.failure) throw new AppError(result.failure, 400);
  await signed(res, result.user, result.raw);
});
exports.verifyLink = catchAsync(async (req, res) => {
  only(req, ["flowId", "code"]);
  const result = await transaction(async session => {
    const checked = await challenges.check(req, "link", session);
    if (checked.failure) return checked;
    const { flow } = checked;
    const user = await User.findOne({
      _id: flow.user,
      emailKey: flow.emailKey,
      tokenVersion: flow.version,
    })
      .select("+googleSub")
      .session(session);
    active(user);
    if (
      user.googleSub ||
      (await User.exists({ googleSub: flow.googleSub }).session(session))
    )
      throw new AppError("Google identity already linked. Sign in again.", 409);
    user.googleSub = flow.googleSub;
    user.tokenVersion++;
    await user.save({ session });
    await Session.deleteMany({ user: user._id }, { session });
    await Flow.updateMany(
      { user: user._id, consumed: false },
      { $set: { consumed: true } },
      { session },
    );
    return { user, raw: await security.issue(user, session) };
  });
  if (result.failure) throw new AppError(result.failure, 400);
  await signed(res, result.user, result.raw);
});
exports.recovery = catchAsync(async (req, res) => {
  only(req, ["email", "operationId"]);
  const identity = gmail(req.body.email);
  const flow = await transaction(async session => {
    const user = await User.findOne({
      emailKey: identity.emailKey,
      status: "active",
      emailVerifiedAt: { $exists: true },
    }).session(session);
    if (!user) return inert(req, "recovery", identity, session);
    return challenges.admit(
      {
        browser: req.authBrowser,
        purpose: "recovery",
        email: user.email,
        emailKey: user.emailKey,
        user: user._id,
        version: user.tokenVersion,
        operationId: req.body.operationId,
      },
      session,
    );
  });
  response(res, flow);
});
exports.verifyRecovery = catchAsync(async (req, res) => {
  only(req, ["flowId", "code"]);
  const result = await transaction(async session => {
    const checked = await challenges.check(req, "recovery", session);
    if (checked.failure) return checked;
    const { flow } = checked;
    const user = await User.findOne({
      _id: flow.user,
      tokenVersion: flow.version,
    }).session(session);
    active(user);
    flow.consumed = true;
    await flow.save({ session });
    const id = security.random();
    await Flow.create(
      [
        {
          _id: id,
          browser: req.authBrowser,
          purpose: "reset",
          emailKey: flow.emailKey,
          user: user._id,
          version: user.tokenVersion,
          expiresAt: new Date(Date.now() + 300000),
        },
      ],
      { session },
    );
    return { resetId: id };
  });
  if (result.failure) throw new AppError(result.failure, 400);
  res.json({ status: "success", data: result });
});
exports.completeRecovery = catchAsync(async (req, res) => {
  only(req, ["resetId", "password"]);
  if (
    typeof req.body.resetId !== "string" ||
    !/^[a-f0-9]{64}$/.test(req.body.resetId)
  )
    throw new AppError("Invalid reset request.", 400);
  passwords.validatePassword(req.body.password);
  const passwordHash = await passwords.hash(req.body.password);
  await transaction(async session => {
    const flow = await Flow.findOne({
      _id: req.body.resetId,
      browser: req.authBrowser,
      purpose: "reset",
      consumed: false,
      expiresAt: { $gt: new Date() },
    }).session(session);
    if (!flow) throw new AppError("Password reset expired. Start again.", 400);
    const user = await User.findOne({
      _id: flow.user,
      tokenVersion: flow.version,
    }).session(session);
    active(user);
    user.passwordHash = passwordHash;
    user.tokenVersion++;
    await user.save({ session });
    await Session.deleteMany({ user: user._id }, { session });
    await Flow.updateMany(
      { user: user._id, consumed: false },
      { $set: { consumed: true } },
      { session },
    );
  });
  security.clearSession(res);
  res.json({
    status: "success",
    message: "Password saved. Sign in again.",
    data: {},
  });
});
exports.resend = catchAsync(async (req, res) => {
  only(req, ["flowId", "operationId"]);
  if (
    typeof req.body.flowId !== "string" ||
    !/^[a-f0-9]{64}$/.test(req.body.flowId)
  )
    throw new AppError("Invalid request.", 400);
  const flow = await withControls(async ({ session, controls }) => {
    const old = await Flow.findOne({
      _id: req.body.flowId,
      browser: req.authBrowser,
      purpose: { $in: ["register", "link", "recovery"] },
      expiresAt: { $gt: new Date() },
    })
      .select("+passwordHash")
      .session(session);
    if (!old) throw new AppError("Request expired. Start again.", 400);
    const previous = await Flow.findById(
      challenges.operationKey(
        req.authBrowser,
        old.purpose,
        req.body.operationId,
      ),
    ).session(session);
    // A lost resend response can be retried after the original flow was superseded.
    if (previous && previous.emailKey === old.emailKey) return previous;
    if (old.consumed) throw new AppError("Request expired. Start again.", 400);
    if (old.purpose === "register" && !controls.registrationOpen)
      throw new AppError("Registration is closed.", 403);
    if (old.user) {
      const user = await User.findOne({
        _id: old.user,
        tokenVersion: old.version,
      }).session(session);
      active(user);
    }
    return challenges.admit(
      {
        ...old.toObject(),
        browser: req.authBrowser,
        operationId: req.body.operationId,
      },
      session,
    );
  });
  response(res, flow);
});
exports.me = catchAsync(async (req, res) =>
  res.json({
    status: "success",
    data: { sessionKey: req.studentSession._id, user: await profile(req.user) },
  }),
);
exports.logout = catchAsync(async (req, res) => {
  const id = security.sessionId(req);
  if (id) await Session.deleteOne({ _id: id });
  security.clearSession(res);
  res.json({ status: "success", data: {} });
});

exports.pending = catchAsync(async (req, res) => {
  const raw = security.browser(req, res);
  const flow =
    raw &&
    (await Flow.findOne({
      browser: security.digest(raw),
      purpose: { $in: ["register", "link", "recovery"] },
      consumed: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 }));
  let data = flow ? challenges.summary(flow) : {};
  if (flow) {
    const mail = await Mail.findById(flow._id).select("status errorCode");
    data.delivery =
      mail?.status === "sent"
        ? "sent"
        : mail?.status === "failed"
          ? "failed"
          : "pending";
    if (data.delivery === "failed")
      data.deliveryMessage =
        mail.errorCode === "quota"
          ? "The email allowance has been reached. Please try again later."
          : "Email delivery failed. Wait for the resend button, or try again later.";
  }
  res.json({ status: "success", data });
});
