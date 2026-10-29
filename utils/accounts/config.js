const AppError = require("../appError");
exports.settings = () => {
  const origin = process.env.AUTH_ORIGIN || "http://localhost:5173";
  const url = new URL(origin);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.origin !== origin || (!local && url.protocol !== "https:"))
    throw new Error(
      "AUTH_ORIGIN must be an exact HTTPS origin (HTTP allowed only for localhost).",
    );
  const environment = process.env.AUTH_ENVIRONMENT || "local";
  if (!["local", "production"].includes(environment))
    throw new Error("AUTH_ENVIRONMENT must be local or production.");
  if (environment === "production" && (local || origin !== "https://gusto-thadingyut-festival.eddiespace.com" || process.env.NODE_ENV !== "production"))
    throw new Error("Production authentication requires the approved HTTPS origin and NODE_ENV=production.");
  return {
    environment,
    origin,
    secure: url.protocol === "https:",
    clientId:
      process.env[
        local ? "GOOGLE_CLIENT_ID_DEVELOPMENT" : "GOOGLE_CLIENT_ID_PRODUCTION"
      ],
    from:
      process.env.AUTH_EMAIL_FROM ||
      "GUSTO Thadingyut Festival <noreply@auth.eddiespace.com>",
  };
};
exports.validate = () => {
  const config = exports.settings();
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
  if (config.environment === "production") {
    if (config.clientId !== "307069587123-a38ssh3vg3fg7o0tvgnaan3mcssa9unb.apps.googleusercontent.com")
      throw new Error("Use the approved production Google client.");
    if (!/^[^<>\r\n]+<[^<>\s]+@auth\.eddiespace\.com>$/.test(config.from))
      throw new Error("Production email sender must use the verified auth.eddiespace.com domain.");
    if ((process.env.HOST || "127.0.0.1") !== "127.0.0.1" || String(process.env.PORT || "5000") !== "5000")
      throw new Error("Production API must listen on 127.0.0.1:5000 behind Nginx.");
  }
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
