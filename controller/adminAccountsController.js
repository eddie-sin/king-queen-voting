const bcrypt = require("bcryptjs");
const Admin = require("../model/adminsModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");

// Mounted behind full-admin authorization. There is no client-selectable role
// or public registration path for administrator accounts.
exports.createMemoryAdmin = catchAsync(async (req, res) => {
  const body = req.body || {};
  if (Object.keys(body).some((field) => !["username", "password"].includes(field))) {
    throw new AppError("Only username and password may be provided.", 400);
  }
  const { username, password } = body;
  if (typeof username !== "string" || !username.trim() || username.trim().length > 100) {
    throw new AppError("A username between 1 and 100 characters is required.", 400);
  }
  if (typeof password !== "string" || !password.trim() || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    throw new AppError("Password must be at least 8 characters and at most 72 UTF-8 bytes.", 400);
  }
  const admin = await Admin.create({
    username: username.trim(), passwordHash: await bcrypt.hash(password, 12), role: "MEMORY_ADMIN",
  });
  res.status(201).json({ status: "success", data: { admin: {
    id: admin._id, username: admin.username, role: admin.role, status: admin.status,
  } } });
});
