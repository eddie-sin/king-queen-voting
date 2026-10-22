const Wish = require("../model/wishesModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const clock = require("../utils/clock");
const mongoose = require("mongoose");

const publicWish = (wish) => ({ id: wish._id.toString(), message: wish.message });
const encodeCursor = (wish) => Buffer.from(JSON.stringify([wish.createdAt.toISOString(), wish._id.toString()])).toString("base64url");
const decodeCursor = (value) => {
  try {
    if (typeof value !== "string" || value.length > 256) throw new Error();
    const [date, id] = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof date !== "string" || !Number.isFinite(Date.parse(date)) || !mongoose.isObjectIdOrHexString(id)) throw new Error();
    return { createdAt: new Date(date), id: new mongoose.Types.ObjectId(id) };
  } catch {
    throw new AppError("Invalid wish cursor.", 400);
  }
};

exports.getStatus = catchAsync(async (req, res) => {
  res.status(200).json({ status: "success", data: { wishSky: { isOpen: true, maxWishes: 3 } } });
});

exports.getMyWishAllowance = catchAsync(async (req, res) => {
  const used = await Wish.countDocuments({ user: req.userId });
  res.status(200).json({ status: "success", data: { used, remaining: Math.max(0, 3 - used) } });
});

exports.getWishes = catchAsync(async (req, res) => {
  const page = Number(req.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) {
    throw new AppError("page must be an integer between 1 and 1000000.", 400);
  }
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new AppError("limit must be an integer between 1 and 50.", 400);
  const cursor = req.query.cursor === undefined ? null : decodeCursor(req.query.cursor);
  if (cursor && req.query.page !== undefined) throw new AppError("Use either page or cursor.", 400);
  const filter = cursor ? { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }] } : {};
  const query = Wish.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
  if (!cursor && req.query.page !== undefined) query.skip((page - 1) * limit);
  const found = await query;
  const wishes = found.slice(0, limit);
  const nextCursor = found.length > limit && wishes.length ? encodeCursor(wishes[wishes.length - 1]) : null;
  res.status(200).json({ status: "success", results: wishes.length, data: { wishes: wishes.map(publicWish), page, nextCursor } });
});

exports.createWish = catchAsync(async (req, res) => {
  const body = req.body || {};
  if (Object.keys(body).some((key) => key !== "message") || typeof body.message !== "string" || !body.message.trim()) {
    throw new AppError("Supply only a non-empty message.", 400);
  }
  for (let slot = 1; slot <= 3; slot++) {
    let wish;
    try {
      wish = await Wish.create({ user: req.userId, slot, message: body.message.trim(), createdAt: clock.now() });
    } catch (error) {
      if (error.code === 11000) continue;
      throw error;
    }
    return res.status(201).json({ status: "success", data: { wish: publicWish(wish) } });
  }
  throw new AppError("Each account can write a maximum of 3 wishes.", 409);
});
