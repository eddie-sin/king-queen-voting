import { csrfHeaders, clearAuthConfig } from '../authSession.js';
// Only id + message cross the presentation boundary. Authors/timestamps are discarded.
export const WISH_LIMIT = 3;
export function publicWish(raw) {
  if (!raw || typeof raw.id !== 'string' || typeof raw.message !== 'string' || !raw.message.trim()) return null;
  return { id: raw.id, message: raw.message };
}
export function normalizeAllowance(raw) {
  if (!Number.isInteger(raw?.used) || raw.used < 0) throw new Error('Your wish allowance could not be verified.');
  return { used: raw.used, remaining: Math.max(0, WISH_LIMIT - raw.used) };
}
export class WishError extends Error {
  constructor(message, { status = 0, interrupted = false } = {}) { super(message); this.status = status; this.interrupted = interrupted; }
}
export function createWishApi(config = null) {
  if (!config) {
    const unavailable = async () => { throw new WishError('The wish sky is not connected yet. Please try again later.'); };
    return { list: unavailable, allowance: unavailable, create: unavailable };
  }
  // The config maps the real backend response shapes.
  // listRequest({cursor,limit}) / allowanceRequest() / createRequest(message)
  // each returns {path,method,body?}; paths are relative to /api/v1.
  const { baseUrl = '/api/v1', fetchImpl = (...args) => fetch(...args) } = config;
  async function request(spec, token, signal) {
    if (!spec?.path?.startsWith('/') || spec.path.startsWith('//')) throw new WishError('Wish endpoint configuration is incomplete.');
    const controller = new AbortController();const abort = () => controller.abort();
    const timeout = setTimeout(abort, 20000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try {
      const response = await fetchImpl(baseUrl + spec.path, { method:spec.method || 'GET', signal:controller.signal, cache:'no-store',credentials:'same-origin',
        headers:{Accept:'application/json',...((spec.method||'GET')!=='GET'?await csrfHeaders(fetchImpl,baseUrl):{}),...(spec.body?{'Content-Type':'application/json'}:{})},...(spec.body?{body:JSON.stringify(spec.body)}:{}) });
      let body;try{body=await response.json();}catch{throw new WishError('The wish response could not be read.',{status:response.status,interrupted:spec.method==='POST'});}
      if(response.status===403)clearAuthConfig();
      if(!response.ok || body.status==='fail' || body.status==='error') throw new WishError(response.status===401?'Please sign in again to release a wish.':response.status===403||response.status===409?'This wish could not be released. Refresh your remaining wishes.':'The wish service could not complete this request.',{status:response.status,interrupted:response.status>=500&&spec.method==='POST'});
      return body;
    }catch(error){if(error instanceof WishError)throw error;throw new WishError('Connection interrupted. Please check your connection.',{interrupted:spec.method==='POST'});}
    finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }
  return {
    async list({cursor=null,limit=40,signal}={}) {
      const result=config.mapList(await request(config.listRequest({cursor,limit}),null,signal));
      if(!Array.isArray(result?.wishes))throw new WishError('Wishes could not be loaded.');
      return {wishes:result.wishes.map(publicWish).filter(Boolean), nextCursor:result.nextCursor??null,total:Number.isInteger(result.total)?result.total:null};
    },
    async allowance(token,{signal}={}) { if(!token)throw new WishError('Sign in to release a wish.');return normalizeAllowance(config.mapAllowance(await request(config.allowanceRequest(),token,signal))); },
    async create(token,message,{signal}={}) {
      if(!token)throw new WishError('Sign in to release a wish.');
      if(!message.trim())throw new WishError('Write a wish before releasing your lantern.');
      const result=config.mapCreated(await request(config.createRequest(message.trim()),token,signal));const wish=publicWish(result?.wish);
      if(!wish)throw new WishError('The release response was incomplete. Check your remaining wishes before trying again.',{interrupted:true});
      return {wish};
    }
  };
}
