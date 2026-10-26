import { WishError } from '../wishes/wishApi.js';
// Explicit development/test fixtures. No localStorage. Never imported in production.
export function createWishFixtureApi({count=137,delayMs=100, accountForToken=async token=>token}={}){
 const messages=['May our small acts of kindness keep glowing.','For friendship, new beginnings, and a joyful year.','May every student find the courage to follow their dreams.','A little peace, a little laughter, and more time with the people we love.','May the light we share return to us as kindness.','For a future filled with learning, hope and togetherness.'];
 const wishes=Array.from({length:count},(_,i)=>({id:`wish-fixture-${i}`,message:messages[i%messages.length]}));
 const accounts=new Map();let sequence=count;
 const wait=()=>new Promise(r=>setTimeout(r,delayMs));
 return {
  async list({cursor=null,limit=40}={}){await wait();const start=Number(cursor||0),end=start+limit;return {wishes:wishes.slice(start,end),nextCursor:end<wishes.length?String(end):null,total:wishes.length};},
  async allowance(token){await wait();if(!token)throw new WishError('Please sign in.',{status:401});const account=await accountForToken(token);return {used:accounts.get(account)||0};},
  async create(token,message){await wait();if(!token)throw new WishError('Please sign in.',{status:401});const account=await accountForToken(token);const used=accounts.get(account)||0;if(used>=3)throw new WishError('You have released all three wishes.',{status:409});if(!message.trim())throw new WishError('Write a wish before releasing your lantern.');const wish={id:`wish-fixture-${sequence++}`,message:message.trim()};accounts.set(account,used+1);wishes.push(wish);return {wish};}
 };
}
