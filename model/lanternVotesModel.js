const mongoose = require('mongoose');
const schema = new mongoose.Schema({user:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,unique:true},lantern:{type:mongoose.Schema.Types.ObjectId,ref:'Image',required:true}},{timestamps:true});
schema.index({lantern:1});
module.exports=mongoose.model('LanternVote',schema);
