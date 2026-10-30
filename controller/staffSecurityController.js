const crypto = require('node:crypto');
const Admin = require('../model/adminsModel');
const passwords = require('../utils/passwords');
const {transaction} = require('../utils/transactions');
const {authorizeStaff,audit} = require('../utils/eventControls');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
exports.change = catchAsync(async(req,res)=>{
  const revokeOnly = req.path.endsWith('/revoke');
  const fields = revokeOnly ? ['currentPassword'] : ['currentPassword','password'];
  if (!req.body || Object.keys(req.body).some(k=>!fields.includes(k)) || typeof req.body.currentPassword!=='string' || Buffer.byteLength(req.body.currentPassword)>72) throw new AppError('Provide your current password.',400);
  if (!revokeOnly) passwords.validateStaffPassword(req.body.password);
  const account = await Admin.findById(req.admin._id).select('+passwordHash');
  if (!account || !await passwords.compare(req.body.currentPassword,account.passwordHash)) throw new AppError('Current password is incorrect.',400);
  const hash = revokeOnly ? null : await passwords.hash(req.body.password);
  // One operation id across callback retries; no passwords or tokens in audit details.
  const operationId = crypto.randomUUID();
  await transaction(async session=>{
    const current = await authorizeStaff(req.admin,undefined,session);
    const changed = await Admin.findOneAndUpdate({_id:current._id,tokenVersion:req.admin.tokenVersion,passwordHash:account.passwordHash},{$inc:{tokenVersion:1},...(!revokeOnly?{$set:{passwordHash:hash}}:{})},{new:true,session});
    if (!changed) throw new AppError('Your account changed. Sign in again.',401);
    await audit(session,current,revokeOnly?'staff.sessions.revoke':'staff.password.change',{},operationId);
  });
  res.json({status:'success',data:{signedOut:true},message:'All sessions for this staff account have ended. Sign in again.'});
});
