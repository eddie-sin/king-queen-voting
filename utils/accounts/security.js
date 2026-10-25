const crypto = require("node:crypto");
const { settings } = require("./config");
const { Session } = require("../../model/studentAuthModels");
const AppError = require("../appError");
exports.random = () => crypto.randomBytes(32).toString("hex");
exports.digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
exports.mac = (value) =>
  crypto
    .createHmac("sha256", process.env.AUTH_OTP_SECRET)
    .update(value)
    .digest("hex");
exports.equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const names = () => ({
  browser: settings().secure ? "__Host-kq_browser" : "kq_browser",
  session: settings().secure ? "__Host-kq_session" : "kq_session",
});
exports.cookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim().split("="))
      .filter((v) => v.length === 2),
  );
const cookie = (res, name, value, maxAge) =>
  res.cookie(name, value, {
    httpOnly: true,
    secure: settings().secure,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
exports.browser = (req, res, create = false) => {
  const raw = exports.cookies(req)[names().browser];
  let id;
  if (raw) {
    const [candidate, expiry, signature] = raw.split(".");
    if (
      /^[a-f0-9]{64}$/.test(candidate || "") &&
      Number(expiry) > Date.now() &&
      exports.equal(signature, exports.mac(`browser:${candidate}:${expiry}`))
    )
      id = candidate;
  }
  if (!id && create) {
    id = exports.random();
    const expiry = Date.now() + 86400000;
    cookie(
      res,
      names().browser,
      `${id}.${expiry}.${exports.mac(`browser:${id}:${expiry}`)}`,
      86400000,
    );
  }
  return id;
};
exports.csrf = (browser) => exports.mac(`csrf:${browser}`);
exports.guard = (req, res, next) => {
  try {
    const browser = exports.browser(req, res);
    if (
      req.headers.origin !== settings().origin ||
      !browser ||
      !exports.equal(req.headers["x-csrf-token"], exports.csrf(browser))
    )
      throw new AppError("Refresh this page before continuing.", 403);
    req.authBrowser = exports.digest(browser);
    next();
  } catch (e) {
    next(e);
  }
};
exports.issue = async (user, session) => {
  const raw = exports.random();
  await Session.create(
    [
      {
        _id: exports.digest(raw),
        user: user._id,
        version: user.tokenVersion,
        expiresAt: new Date(Date.now() + 5 * 3600000),
      },
    ],
    { session },
  );
  return raw;
};
exports.setSession = (res, raw) =>
  cookie(res, names().session, raw, 5 * 3600000);
exports.sessionId = (req) => {
  const raw = exports.cookies(req)[names().session];
  return /^[a-f0-9]{64}$/.test(raw || "") ? exports.digest(raw) : null;
};
exports.clearSession = (res) =>
  res.clearCookie(names().session, {
    httpOnly: true,
    secure: settings().secure,
    sameSite: "lax",
    path: "/",
  });
exports.seal = (value) => {
  const iv = crypto.randomBytes(12),
    c = crypto.createCipheriv(
      "aes-256-gcm",
      Buffer.from(process.env.AUTH_MAIL_SECRET, "hex"),
      iv,
    );
  const out = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), out]).toString("base64");
};
exports.unseal = (value) => {
  const b = Buffer.from(value, "base64"),
    d = crypto.createDecipheriv(
      "aes-256-gcm",
      Buffer.from(process.env.AUTH_MAIL_SECRET, "hex"),
      b.subarray(0, 12),
    );
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(),
  );
};
