const Wish = require("../model/wishesModel");
const WishReaction = require("../model/wishReactionModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const {withControls,getControls,staffMutation,audit} = require('../utils/eventControls');
const wishText = require('../utils/wishText');
const visible = {hidden:{$ne:true}};
const clock = require("../utils/clock");
const security = require("../utils/accounts/security");
const mongoose = require("mongoose");

const publicWish = (wish) => ({ id: wish._id.toString(), message: wish.message, ...(wish.name ? { name: wish.name } : {}) });
async function withReactions(wishes, req, res) {
  const browser = security.browser(req, res);
  const ids = wishes.map(wish => wish._id);
  const counts = ids.length ? await WishReaction.aggregate([
    { $match: { wish: { $in: ids } } },
    { $group: { _id: '$wish', reactions: { $sum: 1 }, reacted: { $max: { $cond: [{ $eq: ['$browser', browser ? security.digest(browser) : null] }, 1, 0] } } } },
  ]) : [];
  const byId = new Map(counts.map(row => [String(row._id), row]));
  return wishes.map(wish => ({ ...publicWish(wish), reactions: byId.get(String(wish._id))?.reactions || 0, reacted: Boolean(byId.get(String(wish._id))?.reacted) }));
}
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
  const controls=await getControls();
  res.status(200).json({ status: "success", data: { wishSky: { isOpen: controls.wishPostingOpen !== false, moderationRevision: controls.wishModerationRevision || 0, maxWishes: 3 } } });
});

exports.getMyWishAllowance = catchAsync(async (req, res) => {
  const used = await Wish.countDocuments({ user: req.userId });
  res.status(200).json({ status: "success", data: { used, remaining: Math.max(0, 3 - used), isOpen: (await getControls()).wishPostingOpen !== false } });
});

exports.getMyWishes = catchAsync(async (req, res) => {
  const wishes = await Wish.find({ user: req.userId }).select('+hidden').sort({ createdAt: -1, _id: -1 }).limit(3);
  res.status(200).json({ status: 'success', data: { wishes: (await withReactions(wishes, req, res)).map((row,index)=>({...row,...(wishes[index].hidden?{hidden:true}:{})})) } });
});

exports.getWishes = catchAsync(async (req, res) => {
  const page = Number(req.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100) {
    throw new AppError("page must be an integer between 1 and 100; use cursor to continue beyond this.", 400);
  }
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new AppError("limit must be an integer between 1 and 50.", 400);
  const cursor = req.query.cursor === undefined ? null : decodeCursor(req.query.cursor);
  if (cursor && req.query.page !== undefined) throw new AppError("Use either page or cursor.", 400);
  const filter = cursor ? { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }] } : {};
  const query = Wish.find({...filter,...visible}).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
  if (!cursor && req.query.page !== undefined) query.skip((page - 1) * limit);
  const found = await query;
  const wishes = found.slice(0, limit);
  const nextCursor = found.length > limit && wishes.length ? encodeCursor(wishes[wishes.length - 1]) : null;
  const [rows, total] = await Promise.all([withReactions(wishes, req, res), require('../utils/publicCalculations').get('wish-total',()=>Wish.countDocuments(visible),2000)]);
  res.status(200).json({ status: "success", results: wishes.length, data: { wishes: rows, page, nextCursor, total } });
});

exports.createWish = catchAsync(async (req, res) => {
  const body = req.body || {};
  if (Object.keys(body).some((key) => !["message", "name"].includes(key)) || typeof body.message !== "string" || !body.message.trim() || (body.name !== undefined && (typeof body.name !== "string" || body.name.trim().length > 60))) {
    throw new AppError("Supply a non-empty message and an optional name of up to 60 characters.", 400);
  }
  if (!wishText.valid(body.message)) throw new AppError(wishText.message,400);
  const name = body.name?.trim() || undefined;
  for (let slot = 1; slot <= 3; slot++) {
    let wish;
    try {
      wish = await withControls(async ({session,controls})=>{
        if (controls.wishPostingOpen === false) throw new AppError('New wishes are paused by the organisers. Your draft is still here.',403);
        return (await Wish.create([{ user: req.userId, slot, message: body.message.trim(), ...(name ? { name } : {}), createdAt: clock.now() }],{session}))[0];
      });
    } catch (error) {
      if (error.code === 11000) continue;
      throw error;
    }
    require('../utils/publicCalculations').invalidate('wish-total');
    return res.status(201).json({ status: "success", data: { wish: { ...publicWish(wish), reactions: 0, reacted: false } } });
  }
  throw new AppError("Each account can write a maximum of 3 wishes.", 409);
});

exports.reactToWish = catchAsync(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isObjectIdOrHexString(id)) throw new AppError('Wish not found.', 404);
  if (!req.body || Object.keys(req.body).length !== 1 || typeof req.body.active !== 'boolean') {
    throw new AppError('Supply active as true or false.', 400);
  }
  if (!await Wish.exists({ _id: id, ...visible })) throw new AppError('Wish not found.', 404);
  const key = { wish: id, browser: req.authBrowser };
  if (req.body.active) {
    try { await WishReaction.updateOne(key, { $setOnInsert: key }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
  } else {
    await WishReaction.deleteOne(key);
  }
  res.status(200).json({ status: 'success', data: {
    reactions: await WishReaction.countDocuments({ wish: id }),
    reacted: Boolean(await WishReaction.exists(key)),
  } });
});

exports.moderationList = catchAsync(async(req,res)=>{
  const cursor = req.query.cursor === undefined ? null : decodeCursor(req.query.cursor);
  if(Object.keys(req.query).some(k=>k!=='cursor')) throw new AppError('Only cursor is supported.',400);
  const filter = cursor ? {$or:[{createdAt:{$lt:cursor.createdAt}},{createdAt:cursor.createdAt,_id:{$lt:cursor.id}}]} : {};
  const rows = await Wish.find(filter).select('+hidden').sort({createdAt:-1,_id:-1}).limit(51).lean();
  res.json({status:'success',data:{wishes:rows.slice(0,50).map(w=>({...publicWish(w),hidden:w.hidden===true})),nextCursor:rows.length>50?encodeCursor(rows[49]):null}});
});
exports.moderate = catchAsync(async(req,res)=>{
  if(!mongoose.isObjectIdOrHexString(req.params.id) || !req.body || Object.keys(req.body).length!==1 || typeof req.body.hidden!=='boolean') throw new AppError('Provide hidden as true or false for a valid wish.',400);
  await staffMutation(req,'admin',async({session,actor,controls})=>{
    controls.wishModerationRevision=(controls.wishModerationRevision||0)+1;
    const wish=await Wish.findById(req.params.id).session(session).select('+hidden');
    if(!wish)throw new AppError('Wish not found.',404);
    // Update only this field so older long wishes remain moderatable.
    await Wish.updateOne({_id:wish._id},{$set:{hidden:req.body.hidden}},{session});
    await audit(session,actor,req.body.hidden?'wish.hide':'wish.unhide',{wishId:String(wish._id)});
  });
  require('../utils/publicCalculations').invalidate('wish-total');
  res.json({status:'success',data:{hidden:req.body.hidden}});
});
