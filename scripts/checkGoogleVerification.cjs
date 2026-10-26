// Exercise the real Google verification library with an isolated test certificate source.
const assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library"),
  { createVerifier } = require("../utils/accounts/google");
const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }),
  other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
Object.assign(process.env, {
  AUTH_ORIGIN: "http://localhost:5173",
  GOOGLE_CLIENT_ID_DEVELOPMENT: "dev.apps.googleusercontent.com",
  GOOGLE_CLIENT_ID_PRODUCTION: "prod.apps.googleusercontent.com",
});
const client = new OAuth2Client();
client.getFederatedSignonCertsAsync = async () => ({
  certs: { test: keys.publicKey.export({ type: "spki", format: "pem" }) },
  format: "PEM",
});
const verify = createVerifier(client),
  base = {
    sub: "google-test",
    email: "ed.die@gmail.com",
    email_verified: true,
    nonce: "test-nonce",
  };
const sign = (changes = {}, options = {}, key = keys.privateKey) =>
  jwt.sign({ ...base, ...changes }, key, {
    algorithm: "RS256",
    keyid: "test",
    issuer: "https://accounts.google.com",
    audience: "dev.apps.googleusercontent.com",
    expiresIn: "5m",
    ...options,
  });
(async () => {
  assert.equal((await verify(sign())).emailKey, "eddie@gmail.com");
  for (const token of [
    sign({}, {}, other.privateKey),
    sign({}, { audience: "wrong" }),
    sign({}, { issuer: "https://evil.test" }),
    sign({}, { expiresIn: -600 }),
    sign({ email_verified: false }),
    sign({ email: "x@example.com" }),
    sign({ nonce: undefined }),
    "invalid",
  ])
    await assert.rejects(verify(token));
  process.env.AUTH_ORIGIN = "https://gusto-thadingyut-festival.eddiespace.com";
  await assert.rejects(verify(sign()));
  assert.equal(
    (await verify(sign({}, { audience: "prod.apps.googleusercontent.com" })))
      .sub,
    "google-test",
  );
  console.log(
    "Real Google library verification checks passed: signature, issuer, audience, expiry, Gmail, verified email, nonce presence and environment separation.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
