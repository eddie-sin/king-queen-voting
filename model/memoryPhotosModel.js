const mongoose = require("mongoose");

const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const present = (value) => value !== undefined && value !== null;

const assertState = (state) => {
  const invalid = (message) => {
    const error = new mongoose.Error.ValidationError();
    error.addError("status", new mongoose.Error.ValidatorError({ path: "status", message }));
    throw error;
  };
  const forbidden = (fields) => fields.some((field) => present(state[field]) && state[field] !== "");

  if (state.status === "reserved") {
    if (!hasText(state.reservationToken) || !present(state.reservationExpiresAt)) {
      invalid("Reserved photos require a reservation token and expiration time.");
    }
    if (forbidden(["storageKey", "submittedAt", "reviewedBy", "reviewedAt", "rejectionReason"])) {
      invalid("Reserved photos cannot contain submission or review metadata.");
    }
    return true;
  }

  if (state.status === "pending") {
    if (!hasText(state.storageKey) || !present(state.submittedAt)) {
      invalid("Pending photos require a storage key and submission time.");
    }
    if (forbidden(["reservationToken", "reservationExpiresAt", "reviewedBy", "reviewedAt", "rejectionReason"])) {
      invalid("Pending photos cannot contain reservation or review metadata.");
    }
    return true;
  }

  if (state.status === "approved") {
    if (!hasText(state.storageKey) || !present(state.submittedAt) || !present(state.reviewedBy) || !present(state.reviewedAt)) {
      invalid("Approved photos require submission and review metadata.");
    }
    if (forbidden(["reservationToken", "reservationExpiresAt", "rejectionReason"])) {
      invalid("Approved photos cannot contain reservation or rejection metadata.");
    }
    return true;
  }

  if (state.status === "rejected") {
    if (!hasText(state.storageKey) || !present(state.submittedAt) || !present(state.reviewedBy)
      || !present(state.reviewedAt) || !hasText(state.rejectionReason)) {
      invalid("Rejected photos require submission, review, and rejection metadata.");
    }
    if (forbidden(["reservationToken", "reservationExpiresAt"])) {
      invalid("Rejected photos cannot contain reservation metadata.");
    }
    return true;
  }

  invalid("Memory photo status is invalid.");
};

const moderationHistorySchema = new mongoose.Schema({
  status: { type: String, required: true, enum: ["rejected"] },
  storageKey: { type: String, required: true, trim: true },
  submittedAt: { type: Date, required: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
  reviewedAt: { type: Date, required: true },
  rejectionReason: { type: String, required: true, trim: true },
  originalCreatedAt: { type: Date, required: true },
  originalUpdatedAt: { type: Date, required: true },
}, { _id: false });

const memoryPhotoSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  slot: { type: Number, required: true, min: 1, max: 3, validate: Number.isInteger },
  storageKey: { type: String, default: null, trim: true },
  status: { type: String, required: true, enum: ["reserved", "pending", "approved", "rejected"] },
  reservationToken: { type: String, default: null, trim: true },
  reservationExpiresAt: { type: Date, default: null },
  submittedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  reviewedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: null, trim: true },
  moderationHistory: { type: [moderationHistorySchema], default: [] },
}, { timestamps: true });

memoryPhotoSchema.index({ ownerId: 1, slot: 1 }, { unique: true });
memoryPhotoSchema.static("assertState", assertState);
memoryPhotoSchema.pre("validate", function validateMemoryPhotoState() {
  assertState(this);
});

module.exports = mongoose.model("MemoryPhoto", memoryPhotoSchema);
