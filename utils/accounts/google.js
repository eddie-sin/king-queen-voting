const { OAuth2Client } = require("google-auth-library");
const { settings, gmail } = require("./config");
const AppError = require("../appError");
exports.createVerifier =
  (client = new OAuth2Client()) =>
  async (credential) => {
    if (typeof credential !== "string" || credential.length > 12000)
      throw new AppError("Google sign-in response is invalid.", 401);
    let payload;
    try {
      payload = (
        await client.verifyIdToken({
          idToken: credential,
          audience: settings().clientId,
        })
      ).getPayload();
    } catch {
      throw new AppError(
        "Google sign-in could not be verified. Please try again.",
        401,
      );
    }
    if (
      payload.email_verified !== true ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.nonce !== "string"
    )
      throw new AppError("Google sign-in could not be verified.", 401);
    const identity = gmail(payload.email);
    return { ...identity, sub: payload.sub, nonce: payload.nonce };
  };

exports.verify = exports.createVerifier();
