const mongoose = require('mongoose');
const User = require('../model/usersModel');
const Action = require('../model/adminActionsModel');
const { staffMutation, authorizeStaff, audit } = require('../utils/eventControls');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const row = user => ({ id:String(user._id), email:user.email, status:user.status, participationEnabled:user.participationEnabled===true, revision:user.participationRevision||0 });
exports.list = catchAsync(async(req,res)=>{
 await authorizeStaff(req.admin,'participation.read');
 const {search='', access='all', after=''}=req.query;
 if(Object.keys(req.query).some(k=>!['search','access','after'].includes(k)) || typeof search!=='string' || search.length>254 || !['all','enabled','disabled'].includes(access) || typeof after!=='string' || after.length>254) throw new AppError('Invalid user search.',400);
 const query={};
 if(access!=='all')query.participationEnabled=access==='enabled'?true:{$ne:true};
 const prefix=search.trim().toLowerCase();
 if(prefix)query.email={$gte:prefix,$lt:prefix+'\uffff'};
 if(after)query.$and=[{email:{$gt:after}}];
 const users=await User.find(query).select('email status participationEnabled participationRevision').sort({email:1}).limit(26).lean();
 res.json({status:'success',data:{users:users.slice(0,25).map(row),next:users.length>25?users[24].email:null}});
});
exports.update = catchAsync(async(req,res)=>{
 const {enabled,revision,operationId}=req.body||{};
 if(!mongoose.isObjectIdOrHexString(req.params.id) || typeof enabled!=='boolean' || !Number.isSafeInteger(revision) || revision<0 || typeof operationId!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(operationId) || Object.keys(req.body).some(k=>!['enabled','revision','operationId'].includes(k)))throw new AppError('Refresh the user list before saving.',400);
 const user=await staffMutation(req,'participation.update',async({session,actor})=>{
  const receipt=await Action.findOne({operationId}).session(session);
  const target=await User.findById(req.params.id).session(session);
  if(!target)throw new AppError('User not found.',404);
  if(receipt){if(String(receipt.actor)!==String(actor._id)||receipt.action!=='participation.user'||receipt.details.target!==req.params.id||receipt.details.enabled!==enabled)throw new AppError('Operation ID already used.',409);return row(target);}
  if((target.participationRevision||0)!==revision)throw new AppError('This user changed in another session. Refresh and try again.',409);
  const before=target.participationEnabled===true;
  target.participationEnabled=enabled; target.participationRevision=revision+1; target.participationChangedAt=new Date();
  await target.save({session});
  await audit(session,actor,'participation.user',{target:req.params.id,before,enabled},operationId);
  return row(target);
 });
 res.json({status:'success',data:{user}});
});
