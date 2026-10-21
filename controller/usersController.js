const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../model/usersModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");

// Do not return passwordHash or other internal fields to API clients.
const publicUser = (user) => ({
  id: user._id,
  fullName: user.fullName,
  phoneNumber: user.phoneNumber,
  batchNumber: user.batchNumber,
  status: user.status,
});

const validPhone = (phone) => {
  if (typeof phone !== "string") return false;
  const trimmed = phone.trim();
  return /^[+0-9()\-\s]{6,20}$/.test(trimmed) &&
    (trimmed.match(/\d/g) || []).length >= 6;
};

// Feature 1: Register an account. This does not create a login session.
exports.signUp = catchAsync(async (req, res, next) => {
  const { fullName, phoneNumber, batchNumber, password } = req.body || {};

  if (
    typeof fullName !== "string" || !fullName.trim() ||
    !validPhone(phoneNumber) ||
    typeof batchNumber !== "string" || !batchNumber.trim() ||
    typeof password !== "string" ||
    password.length < 8 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return next(new AppError(
      "Provide a name, a valid phone number, a batch number, and a password of at least 8 characters (max 72 UTF-8 bytes).",
      400
    ));
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const user = await User.create({
      fullName: fullName.trim(),
      phoneNumber: phoneNumber.trim(),
      batchNumber: batchNumber.trim(),
      passwordHash,
    });

    res.status(201).json({
      status: "success",
      message: "Account created successfully",
      data: { user: publicUser(user) },
    });
  } catch (err) {
    if (err.code === 11000) {
      return next(new AppError("Phone number already registered", 409));
    }
    return next(err);
  }
});

// Safeguard while login/authentication has NOT been implemented.
// Update/delete below work only on the same computer in development mode.
const localDevOnly = (req, res, next) => {
  const localAddresses = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
  const ip = req.socket.remoteAddress;

  if (process.env.NODE_ENV !== "development" || !localAddresses.includes(ip)) {
    return next(new AppError(
      "Update/delete are disabled outside local development until authentication is implemented.",
      403
    ));
  }
  next();
};
exports.localDevOnly = localDevOnly;

// Feature 5: Change only fullName and/or phoneNumber.
exports.updateProfile = catchAsync(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return next(new AppError("Invalid user ID", 400));
  }

  const supplied = req.body || {};
  const keys = Object.keys(supplied);
  if (!keys.length || keys.some((key) => !["fullName", "phoneNumber"].includes(key))) {
    return next(new AppError("Only fullName and phoneNumber can be updated", 400));
  }

  const updates = {};
  if ("fullName" in supplied) {
    if (typeof supplied.fullName !== "string" || !supplied.fullName.trim()) {
      return next(new AppError("fullName cannot be empty", 400));
    }
    updates.fullName = supplied.fullName.trim();
  }
  if ("phoneNumber" in supplied) {
    if (!validPhone(supplied.phoneNumber)) {
      return next(new AppError("Invalid phoneNumber", 400));
    }
    updates.phoneNumber = supplied.phoneNumber.trim();
  }

  try {
    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!user) return next(new AppError("User not found", 404));

    res.status(200).json({
      status: "success",
      message: "Profile updated successfully",
      data: { user: publicUser(user) },
    });
  } catch (err) {
    if (err.code === 11000) {
      return next(new AppError("Phone number already registered", 409));
    }
    return next(err);
  }
});

// Feature 4: Delete an account (local-development test only).
exports.deleteAccount = catchAsync(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return next(new AppError("Invalid user ID", 400));
  }

  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return next(new AppError("User not found", 404));

  res.status(200).json({
    status: "success",
    message: "Account deleted successfully",
  });
});
