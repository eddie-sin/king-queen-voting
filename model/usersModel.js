const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, "Full name is required"],
    trim: true,
  },
  phoneNumber: {
    type: String,
    required: [true, "Phone number is required"],
    unique: true,
    trim: true,
  },
  batchNumber: {
    type: String,
    required: [true, "Batch number is required"],
    trim: true,
  },
  passwordHash: {
    type: String,
    required: [true, "Password hash is required"],
    select: false,
  },
  credentialIssued: {
    type: Boolean,
    default: false,
  },
  status: {
    type: String,
    enum: ["active", "disabled"],
    default: "active",
  },
});

module.exports = mongoose.model("User", userSchema);
