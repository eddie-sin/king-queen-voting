const crypto = require("crypto");

// Temporary safeguard while the full admin login system is not implemented.
// Write operations can only be tested via Postman on the same computer,
// in development mode, with a secret key stored ONLY on the backend.
module.exports = function agendaAdminOnly(req, res, next) {
  const remoteAddress = req.socket.remoteAddress;
  const isLocal = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress);

  if (process.env.NODE_ENV !== "development" || !isLocal) {
    return res.status(403).json({
      status: "fail",
      message: "Agenda editing is available only from local development for now",
    });
  }

  const expected = process.env.ADMIN_AGENDA_KEY;
  if (!expected || expected.length < 24 || expected === "CHANGE_ME") {
    return res.status(500).json({
      status: "error",
      message: "Configure a strong ADMIN_AGENDA_KEY in config.env",
    });
  }

  const supplied = req.get("x-admin-key") || "";
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  const valid =
    expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);

  if (!valid) {
    return res.status(401).json({
      status: "fail",
      message: "Invalid or missing admin key",
    });
  }

  next();
};
