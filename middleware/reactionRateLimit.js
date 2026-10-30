const AppError = require('../utils/appError');
const maps = new Map();
module.exports = (req,res,next)=>{
  const now=Date.now();
  for(const [k,v] of maps)if(v.until<=now)maps.delete(k);
  const keys=[[`browser:${req.authBrowser}`,120],[`source:${req.ip}`,1200]];
  try{for(const [key,max] of keys){let value=maps.get(key);if(!value){if(maps.size>=4096)throw new AppError('Reactions are busy. Please try again shortly.',429);value={count:0,until:now+60000};maps.set(key,value);}if(++value.count>max)throw new AppError('Please wait before reacting again.',429);}next();}catch(e){res.set('Retry-After','60');next(e);}
};
