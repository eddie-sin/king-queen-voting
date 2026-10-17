const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../model/usersModel");
const Admin = require("../model/adminsModel");
const VotingCredential = require("../model/voting_credentialsModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { hashVotingKey } = require("../utils/votingKey");
const { withElectionTransaction } = require("../utils/election");

const userResponse = (user) => ({
  id: user._id,
  fullName: user.fullName,
  batchNumber: user.batchNumber,
  email: user.email,
  hasVotedKing: user.hasVotedKing,
  hasVotedQueen: user.hasVotedQueen,
});

const tokenResponse = (payload) => ({
  token: jwt.sign(payload, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: process.env.JWT_EXPIRES_IN || "5h",
  }),
  tokenType: "Bearer",
  expiresIn: process.env.JWT_EXPIRES_IN || "5h",
});

exports.register = catchAsync(async (req, res) => {
  const { fullName, batchNumber, email, password } = req.body || {};
  if (![fullName, batchNumber, email, password].every((value) => typeof value === "string" && value.trim())) {
    throw new AppError("Full name, batch number, email, and password are required.", 400);
  }
  if (password.length < 8) throw new AppError("Password must be at least 8 characters.", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new AppError("A valid email is required.", 400);
  const passwordHash = await bcrypt.hash(password, 12);
  const votingKey = crypto.randomBytes(32).toString("hex");
  const user = await withElectionTransaction("registration", async ({ session }) => {
    if (await User.exists({ email: email.trim().toLowerCase() }).session(session)) {
      throw new AppError("Email is already registered.", 409);
    }
    const [created] = await User.create([{
      fullName: fullName.trim(), batchNumber: batchNumber.trim(),
      email: email.trim().toLowerCase(), passwordHash, credentialIssued: true,
    }], { session });
    await VotingCredential.create([{
      codeHash: hashVotingKey(created._id, votingKey), bindingVersion: 2,
    }], { session });
    return created;
  });
  res.status(201).json({
    status: "success",
    message: "Account created. Keep your voting key securely; it is shown only once and cannot be recovered.",
    data: { user: userResponse(user), votingKey },
  });
});

exports.login = catchAsync(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    throw new AppError("Email and password are required.", 400);
  }
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError("Invalid email or password.", 401);
  }
  if (user.status !== "active") throw new AppError("This account is disabled.", 403);
  res.status(200).json({
    status: "success", message: "Login successful.",
    data: { ...tokenResponse({ userId: user._id.toString(), role: "user" }), user: userResponse(user) },
  });
});

exports.adminLogin = catchAsync(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || !username.trim() || typeof password !== "string" || !password) {
    throw new AppError("Username and password are required.", 400);
  }
  const admin = await Admin.findOne({ username: username.trim() }).select("+passwordHash");
  if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
    throw new AppError("Invalid username or password.", 401);
  }
  if (admin.status !== "active") throw new AppError("This admin account is disabled.", 403);
  res.status(200).json({
    status: "success",
    data: { ...tokenResponse({ adminId: admin._id.toString(), role: "admin" }), admin: { username: admin.username } },
  });
});

exports.getMe = catchAsync(async (req, res) => {
  res.status(200).json({ status: "success", data: { user: userResponse(req.user) } });
});
