require("dotenv").config({ path: "./config.env" });

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Admin = require("./model/adminsModel");

async function resetPassword() {
  await mongoose.connect(process.env.DATABASE_LOCAL);

  const admin = await Admin.findOne({ username: "admin" });

  if (!admin) {
    throw new Error("Admin account not found");
  }

  const password = process.env.ADMIN_PASSWORD;

  if (!password || password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters");
  }

  admin.passwordHash = await bcrypt.hash(password, 12);
  await admin.save();

  console.log("Admin password reset successfully");
}

resetPassword()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
