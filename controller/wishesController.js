const Wish = require("../model/wishesModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const wishSky = require("../utils/wishSky");
const clock = require("../utils/clock");

const publicWish = (wish) => ({ id: wish._id, message: wish.message, createdAt: wish.createdAt });

exports.getStatus = catchAsync(async (req, res) => {
  res.status(200).json({ status: "success", data: { wishSky: wishSky.getStatus() } });
});

exports.getWishes = catchAsync(async (req, res) => {
  wishSky.requireOpen();
  const page = Number(req.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) {
    throw new AppError("page must be an integer between 1 and 1000000.", 400);
  }
  const wishes = await Wish.find().sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 50).limit(50);
  wishSky.requireOpen();
  res.status(200).json({ status: "success", results: wishes.length, data: { wishes: wishes.map(publicWish), page } });
});

exports.createWish = catchAsync(async (req, res) => {
  wishSky.requireOpen();
  const body = req.body || {};
  if (Object.keys(body).some((key) => key !== "message") || typeof body.message !== "string" || !body.message.trim() || body.message.trim().length > 500) {
    throw new AppError("Supply only message, containing 1 to 500 characters.", 400);
  }
  for (let slot = 1; slot <= 3; slot++) {
    wishSky.requireOpen();
    let wish;
    try {
      wish = await Wish.create({ user: req.userId, slot, message: body.message.trim(), createdAt: clock.now() });
    } catch (error) {
      if (error.code === 11000) continue;
      throw error;
    }
    try { wishSky.requireOpen(); } catch (error) {
      await Wish.deleteOne({ _id: wish._id });
      throw error;
    }
    return res.status(201).json({ status: "success", data: { wish: publicWish(wish) } });
  }
  throw new AppError("Each account can write a maximum of 3 wishes.", 409);
});
