const AppError = require("../appError");
exports.settings = () => {
  const origin = process.env.AUTH_ORIGIN || "http://localhost:5173";
  const url = new URL(origin);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.origin !== origin || (!local && url.protocol !== "https:"))
    throw new Error(
      "AUTH_ORIGIN must be an exact HTTPS origin (HTTP allowed only for localhost).",
    );
  return {
    origin,
    secure: url.protocol === "https:",
    clientId:
      process.env[
        local ? "GOOGLE_CLIENT_ID_DEVELOPMENT" : "GOOGLE_CLIENT_ID_PRODUCTION"
      ],
    from:
      process.env.AUTH_EMAIL_FROM ||
      "Thadingyut Voting <noreply@auth.eddiespace.com>",
  };
};
exports.validate = () => {
  exports.settings();
  for (const key of ["AUTH_OTP_SECRET", "AUTH_MAIL_SECRET"])
    if (!/^[a-f0-9]{64}$/i.test(process.env[key] || ""))
      throw new Error(`${key} must be a separate random 32-byte hex secret.`);
  if (
    process.env.AUTH_OTP_SECRET.toLowerCase() ===
    process.env.AUTH_MAIL_SECRET.toLowerCase()
  )
    throw new Error(
      "AUTH_OTP_SECRET and AUTH_MAIL_SECRET must be different secrets.",
    );
  if (!process.env.RESEND_API_KEY || !exports.settings().clientId)
    throw new Error(
      "Configure Resend and the Google client for AUTH_ORIGIN before starting.",
    );
};
exports.gmail = (value) => {
  if (typeof value !== "string" || value.length > 254)
    throw new AppError("Use a valid @gmail.com address.", 400);
  const email = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:\.?[a-z0-9]+)*(?:\+[a-z0-9._-]+)?@gmail\.com$/.test(email))
    throw new AppError("Use a valid @gmail.com address.", 400);
  return {
    email,
    emailKey:
      email.split("@")[0].split("+")[0].replaceAll(".", "") + "@gmail.com",
  };
};
