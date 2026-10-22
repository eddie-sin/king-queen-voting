import { useCallback, useEffect, useRef, useState } from 'react';
import { WishFeed } from './WishFeed.js';
import { normalizeAllowance } from './wishApi.js';
export function useWishSky(api,session,capacity){
  const [slots,setSlots]=useState([]),[state,setState]=useState('loading'),[error,setError]=useState('');
  const [quota,setQuota]=useState(null),[quotaError,setQuotaError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const [release,setRelease]=useState(null),[reload,setReload]=useState(0);
  const feed=useRef(null),current=useRef([]),epoch=useRef(0),mutex=useRef(false),requests=useRef(new Set()),releaseWishId=useRef(null);
  const token=session?.token;
  const quotaVersion=useRef(0);
  const loadQuota=useCallback(async()=>{
    const version=++quotaVersion.current;if(!token){setQuota(null);return null;}
    setQuotaError('');
    try{const result=normalizeAllowance(await api.allowance(token));if(version!==quotaVersion.current)return null;setQuota(result);return result;}
    catch(e){if(version===quotaVersion.current){setQuota(null);setQuotaError(e.message);}return null;}
  },[api,token]);
  useEffect(()=>{epoch.current++;setQuota(null);setQuotaError('');setUncertain(false);loadQuota();return()=>{epoch.current++;quotaVersion.current++;};},[loadQuota]);
  useEffect(()=>{
    const controller=new AbortController();let live=true;const source=new WishFeed(api,controller.signal);feed.current=source;
    setState('loading');setError('');setSlots([]);current.current=[];
    (async()=>{try{
      const count=await source.init();const initial=[];
      for(let i=0;i<Math.min(count,capacity);i++){const wish=await source.take(new Set(initial.map(w=>w.id)));if(wish)initial.push(wish);}
      if(!live)return;current.current=initial;setSlots(initial);setState(initial.length?'ready':'empty');
    }catch(e){if(live){setError(e.message);setState('error');}}})();
    return()=>{live=false;controller.abort();if(feed.current===source)feed.current=null;};
  },[api,capacity,reload]);
  const rotate=useCallback(async(index)=>{
    if(requests.current.has(index))return null;requests.current.add(index);const source=feed.current;
    try{const next=await source?.take(()=>new Set([...current.current.filter((_,i)=>i!==index).map(w=>w.id),releaseWishId.current].filter(Boolean)));
      if(source!==feed.current||!next)return null;
      current.current=current.current.map((w,i)=>i===index?next:w);setSlots([...current.current]);setError('');return next;
    }catch(e){if(source===feed.current)setError(e.message);return null;}
    finally{requests.current.delete(index);}
  },[]);
  async function submit(message){
    if(mutex.current)throw new Error('Your lantern is already being released.');
    if(!token)throw new Error('Sign in to release a wish.');
    if(!quota||!quota.remaining||uncertain)throw new Error('Please check your remaining wishes before releasing.');
    mutex.current=true;setBusy(true);const generation=epoch.current;
    try{
      // Authoritative account check before every release; backend must enforce the cap atomically.
      const before=await loadQuota();if(generation!==epoch.current)return;
      if(!before||!before.remaining)throw new Error('You have no verified wishes remaining.');
      const result=await api.create(token,message);if(generation!==epoch.current)return;
      setQuota({used:before.used+1,remaining:Math.max(0,2-before.used)});
      if(release&&!current.current.some(w=>w.id===release.wish.id)){
        current.current=[release.wish,...current.current].slice(0,capacity);
        setSlots([...current.current]);
      }
      releaseWishId.current=result.wish.id;
      setRelease({wish:result.wish,id:Date.now()});setState('ready');
      // Keep the new wish as an extra slow release lantern until its first journey ends.
      await loadQuota();return result.wish;
    }catch(e){if(generation===epoch.current){
      if(e.interrupted){setUncertain(true);await loadQuota();}
      else if(e.status===401){setQuota(null);setQuotaError('Please sign in again to release a wish.');}
      else await loadQuota();
    }throw e;}
    finally{mutex.current=false;setBusy(false);}
  }
  return {slots,state,error,quota,quotaError,busy,uncertain,release,rotate,submit,loadQuota,retry:()=>setReload(x=>x+1),acknowledgeUncertain:async()=>{if(await loadQuota())setUncertain(false);},finishRelease:()=>{if(release&&!current.current.some(w=>w.id===release.wish.id)){current.current=[release.wish,...current.current].slice(0,capacity);setSlots([...current.current]);}releaseWishId.current=null;setRelease(null);}};
}
