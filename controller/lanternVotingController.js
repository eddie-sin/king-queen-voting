const mongoose=require('mongoose');
const Vote=require('../model/lanternVotesModel');
const Image=require('../model/imagesModel');
const User=require('../model/usersModel');
const {getControls,withControls}=require('../utils/eventControls');
const AppError=require('../utils/appError');
const catchAsync=require('../utils/catchAsync');
exports.winner=async session=>{
 const rows=await Vote.aggregate([{$group:{_id:'$lantern',votes:{$sum:1}}},{$sort:{votes:-1,_id:1}},{$limit:2}]).session(session||null);
 if(!rows.length) throw new AppError('No lantern votes have been recorded.',409);
 if(rows[1]?.votes===rows[0].votes) throw new AppError('The highest lantern total is tied. A single winner cannot be announced.',409);
 const lantern=await Image.findOne({_id:rows[0]._id,section:'lantern'}).session(session||null).lean();
 if(!lantern) throw new AppError('Winning lantern is unavailable.',409);
 return {lantern,votes:rows[0].votes};
};
exports.status=catchAsync(async(req,res)=>{
 const controls=await getControls();
 const winner=controls.lanternAnnouncementOpen?await require('../utils/publicCalculations').get(`lantern:${controls.lanternWindow}:${controls.revision}`,()=>exports.winner()):null;
 const after=await getControls();
 if(after.revision!==controls.revision) throw new AppError('Lantern status changed. Refresh to continue.',409);
 res.json({status:'success',data:{open:controls.lanternVotingOpen===true,announced:controls.lanternAnnouncementOpen===true,window:controls.lanternWindow||0,revision:controls.revision,winner}});
});
exports.mine=catchAsync(async(req,res)=>res.json({status:'success',data:{vote:await Vote.findOne({user:req.userId}).select('lantern -_id').lean()}}));
exports.submit=catchAsync(async(req,res)=>{
 const body=req.body||{};
 if(Object.keys(body).some(k=>!['lanternId','window'].includes(k))||typeof body.lanternId!=='string'||!mongoose.isObjectIdOrHexString(body.lanternId)||!Number.isSafeInteger(body.window)) throw new AppError('Select a lantern and refresh voting status.',400);
 await withControls(async({controls,session})=>{
  if(!await User.exists({_id:req.userId,status:'active',emailVerifiedAt:{$exists:true},tokenVersion:req.user.tokenVersion}).session(session))throw new AppError('Active account required.',403);
  const existing=await Vote.findOne({user:req.userId}).session(session);
  if(existing){if(String(existing.lantern)===body.lanternId)return;throw new AppError('Your lantern vote is final and cannot be changed.',409);}
  if(!controls.lanternVotingOpen||controls.lanternAnnouncementOpen||controls.lanternWindow!==body.window)throw new AppError('Lantern voting is closed or has changed. Refresh first.',409);
  if(!await Image.exists({_id:body.lanternId,section:'lantern'}).session(session))throw new AppError('Lantern not found.',404);
  await Vote.create([{user:req.userId,lantern:body.lanternId}],{session});
 });
 res.json({status:'success',message:'Your lantern vote is recorded.'});
});
