const Candidate=require('../model/candidatesModel');
const Ballot=require('../model/ballotsModel');
const Image=require('../model/imagesModel');
const LanternVote=require('../model/lanternVotesModel');
const AppError=require('./appError');
exports.candidates=async (controls,session)=>{
 const candidates=await Candidate.find().session(session||null).lean();
 const totals=await Ballot.aggregate([{$match:{round:controls.round}},{$group:{_id:'$candidate',votes:{$sum:1}}}]).session(session||null);
 const counts=new Map(totals.map(row=>[String(row._id),row.votes]));
 return candidates.map(candidate=>({candidate,votes:counts.get(String(candidate._id))||0})).sort((a,b)=>b.votes-a.votes||String(a.candidate._id).localeCompare(String(b.candidate._id)));
};
exports.lanterns=async session=>{
 const images=await Image.find({section:'lantern'}).session(session||null).lean();
 const totals=await LanternVote.aggregate([{$group:{_id:'$lantern',votes:{$sum:1}}}]).session(session||null);
 const counts=new Map(totals.map(row=>[String(row._id),row.votes]));
 return images.map(lantern=>({lantern,votes:counts.get(String(lantern._id))||0})).sort((a,b)=>b.votes-a.votes||String(a.lantern._id).localeCompare(String(b.lantern._id)));
};
const {planAwards}=require('./awardSelection.mjs');
exports.selectAwards=(rows, request={mode:'default',picks:{}})=>{
 const plan=planAwards(rows,request.mode,request.picks);
 if(!plan.ready)throw new AppError('Choose each title holder. Tied positions need an explicit choice.',409);
 return {mode:request.mode,picks:plan.selection};
};
exports.awards=(rows,selection)=>{
 const selected=selection?.picks ? selection : exports.selectAwards(rows);
 const plan=planAwards(rows,'manual',selected.picks);
 if(!plan.ready)throw new AppError('Announced title holders are unavailable. Ask an organiser to review the announcement.',409);
 const result={kings:[],queens:[]};
 for(const slot of plan.slots)if(slot.selected)result[slot.category==='king'?'kings':'queens'].push({...slot.selected,title:slot.title});
 return result;
};
