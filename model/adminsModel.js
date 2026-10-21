const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  // Missing roles on legacy accounts hydrate as ADMIN without a migration.
  role: { type: String, enum: ["ADMIN", "MEMORY_ADMIN"], default: "ADMIN", required: true },
  status: { type: String, enum: ["active", "disabled"], default: "active" },
});

module.exports = mongoose.model("Admin", adminSchema);
