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
exports.awards=rows=>{
 const choose=category=>{
  const list=rows.filter(row=>row.candidate.category===category&&row.votes>0);
  for(let rank=0;rank<Math.min(2,list.length);rank++){
   if(list[rank+1]?.votes===list[rank].votes)throw new AppError(`The ${category} title positions are tied. Resolve the tie before announcement.`,409);
  }
  return list.slice(0,2).map((row,index)=>({...row,title:category==='queen'?(index===0?'Miss Thadingyut':'Princess'):(index===0?'Mrs Thadingyut':'Prince')}));
 };
 return {kings:choose('king'),queens:choose('queen')};
};
