const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../model/usersModel");
const Admin = require("../model/adminsModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");

const authenticate = (role) => catchAsync(async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization || !/^Bearer \S+$/.test(authorization)) {
    throw new AppError("Authentication token is required.", 401);
  }
  let decoded;
  try {
    decoded = jwt.verify(authorization.slice(7), process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    throw new AppError("Invalid or expired token.", 401);
  }
  if ((decoded.role || "user") !== role) throw new AppError(`${role} access is required.`, 403);
  const id = role === "admin" ? decoded.adminId : decoded.userId;
  if (typeof id !== "string" || !mongoose.isObjectIdOrHexString(id)) throw new AppError("Invalid token identity.", 401);
  const account = await (role === "admin" ? Admin : User).findById(id);
  if (!account) throw new AppError("This account no longer exists.", 401);
  if (account.status !== "active") throw new AppError("This account is disabled.", 403);
  if (role === "admin") req.admin = account;
  else {
    req.user = account;
    req.userId = account._id.toString();
  }
  next();
});

module.exports = authenticate("user");
module.exports.admin = authenticate("admin");
