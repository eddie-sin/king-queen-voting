const catchAsync=require('../utils/catchAsync');
const {transaction}=require('../utils/transactions');
const {getControls,authorizeStaff}=require('../utils/eventControls');
const totals=require('../utils/voteTotals');
const read=kind=>catchAsync(async(req,res)=>{
 const data=await transaction(async session=>{
  await authorizeStaff(req.admin,kind==='candidates'?'votes.read':'lantern.votes.read',session);
  const controls=await getControls(session);
  return {entries:kind==='candidates'?await totals.candidates(controls,session):await totals.lanterns(session),round:controls.round,capturedAt:new Date().toISOString()};
 });
 res.json({status:'success',data});
});
exports.candidates=read('candidates');exports.lanterns=read('lanterns');
