const m = require("mongoose");
const flow = new m.Schema({
  _id: String,
  browser: { type: String, required: true },
  purpose: {
    type: String,
    enum: ["register", "google", "link", "recovery", "reset"],
    required: true,
  },
  email: String,
  emailKey: String,
  user: m.Schema.Types.ObjectId,
  version: Number,
  passwordHash: { type: String, select: false },
  googleSub: String,
  proofExpiresAt: Date,
  nonce: String,
  otp: { type: String, select: false },
  attempts: { type: Number, default: 0 },
  consumed: { type: Boolean, default: false },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});
flow.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
flow.index({ emailKey: 1, purpose: 1 });
const session = new m.Schema({
  _id: String,
  user: { type: m.Schema.Types.ObjectId, required: true },
  version: Number,
  expiresAt: Date,
});
session.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const limit = new m.Schema({
  _id: String,
  count: { type: Number, default: 0 },
  until: Date,
  last: Date,
});
limit.index({ until: 1 }, { expireAfterSeconds: 86400 });
const mail = new m.Schema({
  _id: String,
  flow: String,
  payload: { type: String, select: false },
  budgetDay: String,
  status: { type: String, default: "pending" },
  attempts: { type: Number, default: 0 },
  nextAt: { type: Date, default: Date.now },
  leaseUntil: Date,
  expiresAt: Date,
  providerId: String,
  errorCode: String,
});
mail.index({ status: 1, nextAt: 1 });
mail.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
exports.Flow = m.model("AuthFlow", flow);
exports.Session = m.model("StudentSession", session);
exports.Limit = m.model("AuthLimit", limit);
exports.Mail = m.model("AuthMail", mail);
