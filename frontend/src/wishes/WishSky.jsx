import { useT } from '../i18n/Language.jsx';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog.jsx';
import { useWishSky } from './useWishSky.js';
export function WishLantern(){return <span className="wish-lantern-shape" aria-hidden="true"><i className="paper-shell"/><i className="lantern-flame"/><i className="lantern-tassel"/></span>;}
const randomBetween = (min,max) => min + Math.random() * (max - min);
function makeFlightPath(fresh = false,previous = null){
 const wind=randomBetween(-105,105),sway=randomBetween(10,27)*(Math.random()<.5?-1:1);
 const duration=previous?parseFloat(previous['--journey']):randomBetween(46,72);
 return {
  '--wx':`${randomBetween(8,92).toFixed(1)}%`,
  '--wy':`${randomBetween(20,74).toFixed(1)}%`,
  '--journey':`${duration.toFixed(1)}s`,
  '--phase':previous?.['--phase']??(fresh?'0s':`${(-duration*randomBetween(.08,.9)).toFixed(1)}s`),
  '--x25':`${(wind*.23+sway).toFixed(1)}px`,
  '--x50':`${(wind*.52-sway*.55).toFixed(1)}px`,
  '--x75':`${(wind*.78+sway*.7).toFixed(1)}px`,
  '--x100':`${wind.toFixed(1)}px`,
  '--sway-period':`${randomBetween(4.8,8.5).toFixed(1)}s`,
  '--sway-phase':`${randomBetween(-8,0).toFixed(1)}s`,
 };
}
function makeAmbientLight(previous = null){
 const drift=randomBetween(-55,55);
 return {
 '--dx':`${randomBetween(3,97).toFixed(1)}%`,
 '--dy':`${randomBetween(10,82).toFixed(1)}%`,
 '--dd':previous?.['--dd']??`${randomBetween(-44,0).toFixed(1)}s`,
 '--ds':randomBetween(.65,1.2).toFixed(2),
 '--ambient-duration':previous?.['--ambient-duration']??`${randomBetween(38,60).toFixed(1)}s`,
 '--ambient-mid':`${(drift*.5+randomBetween(-10,10)).toFixed(1)}px`,
 '--ambient-end':`${drift.toFixed(1)}px`,
 };}
function Atmosphere(){

 const [ambientLights,setAmbientLights]=useState(()=>Array.from({length:18},()=>makeAmbientLight()));
 return <><div className="sky-atmosphere" aria-hidden="true">
  {[1,2].map(n=><div key={n} className={`taunggyi-balloon balloon-${n}`}><img src="/art/wish-balloon.svg" alt=""/></div>)}
  {ambientLights.map((light,i)=><span key={i} className="ambient-lantern" style={light} onAnimationIteration={e=>{if(e.target===e.currentTarget)setAmbientLights(lights=>lights.map((item,index)=>index===i?makeAmbientLight(item):item));}}><i/></span>)}
  <div className="sky-cloud cloud-one"/><div className="sky-cloud cloud-two"/>
  {Array.from({length:25},(_,i)=><i key={i} className="sky-firefly" style={{left:`${i*31%100}%`,top:`${i*43%100}%`,animationDelay:`-${i%8}s`}}/>)}</div>
  <div className="river-scene" aria-hidden="true"><img src="/art/wish-river.svg" alt=""/></div></>;}
function useSkyPreferences(){
 const [small,setSmall]=useState(()=>matchMedia('(max-width:580px)').matches),[reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion:reduce)').matches);
 useEffect(()=>{const a=matchMedia('(max-width:580px)'),b=matchMedia('(prefers-reduced-motion:reduce)');const update=()=>{setSmall(a.matches);setReduced(b.matches);};a.addEventListener('change',update);b.addEventListener('change',update);return()=>{a.removeEventListener('change',update);b.removeEventListener('change',update);};},[]);
 return {capacity:small?12:24,reduced};
}
function ReleasedWish({release,onRead,onFinish}){
  const t = useT();
 const [flight]=useState(()=>makeFlightPath(true));
 return <button className="floating-wish newly-released-wish" style={flight} aria-label={t("Read your released wish")} onClick={()=>onRead({wish:release.wish,index:-1})} onAnimationIteration={e=>{if(e.target===e.currentTarget)onFinish();}}><WishLantern/></button>;
}
export default function WishSky({api,session,onRequireLogin,accountOpen,paused}){
  const t = useT();
 const {capacity,reduced}=useSkyPreferences();const model=useWishSky(api,session,capacity);
 const [compose,setCompose]=useState(false),[requested,setRequested]=useState(false),[reading,setReading]=useState(null),[draft,setDraft]=useState(''),[formError,setFormError]=useState(''),[notice,setNotice]=useState('');
 const [flightPaths,setFlightPaths]=useState(()=>Array.from({length:24},()=>makeFlightPath()));
 const composingAccount=useRef(session?.token);
 useEffect(()=>{
  if(!reduced||!model.release)return;
  const timer=setTimeout(()=>model.finishRelease(),6000);
  return()=>clearTimeout(timer);
 },[reduced,model.release?.id]);
 useEffect(()=>{const old=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=old;};},[]);
 useEffect(()=>{if(composingAccount.current!==session?.token){setDraft('');setCompose(false);setFormError('');composingAccount.current=session?.token;}},[session?.token]);
 useEffect(()=>{if(requested&&session&&!accountOpen){setRequested(false);setCompose(true);}},[requested,session,accountOpen]);
 useEffect(()=>{if(!requested||accountOpen||session)return;setRequested(false);},[requested,accountOpen,session]);
 const releaseButton=()=>{if(!session){setRequested(true);onRequireLogin();}else{setFormError('');setCompose(true);}};
 const remaining=model.quota?.remaining;
 const reroute=i=>setFlightPaths(paths=>paths.map((path,index)=>index===i?makeFlightPath(false,path):path));
 return <div className={`wish-world ${paused?'motion-paused':''} ${reading||compose||accountOpen?'wish-dialog-open':''}`}>
  <Atmosphere/>
  <div className="wish-world-content"><section className="wish-section" aria-label={t("Wish sky")}><div className="free-sky-heading"><div className="eyebrow">{t("LET A LITTLE HOPE TAKE FLIGHT")}</div><h2>{t("A sky full of ")}<em>{t("wishes.")}</em></h2><p aria-live="polite">{t(model.total===null?'Gathering wishes…':`${model.total} ${model.total===1?'wish':'wishes'} in our shared sky`)}</p><p>{t("Tap a glowing golden lantern to read its wish. The small distant lights decorate the sky.")}</p></div>
   <div className="wish-sky" role="group" aria-label={t("Anonymous wishes drifting across the full sky")}><div className="wish-lantern-grid">
    {model.slots.map((wish,i)=>model.release?.wish.id===wish.id?null:<button key={i} className="floating-wish" style={flightPaths[i]} aria-label={t(`Read wish ${i+1}`)} onClick={()=>setReading({wish,index:i})} onAnimationIteration={e=>{if(e.target===e.currentTarget){reroute(i);model.rotate(i);}}}><WishLantern/></button>)}
    {model.release&&<ReleasedWish key={model.release.id} release={model.release} onRead={setReading} onFinish={model.finishRelease}/>}
   </div></div>
   <div className="sky-actions"><button className="btn primary" onClick={releaseButton} disabled={model.busy}>{t(model.busy?'Releasing…':'Release a wish')}</button>
    <p className="wish-quota-note">{t(session?remaining===undefined?'Checking your remaining wishes…':remaining===0?'Your three wishes have joined the sky.':`${remaining} of 3 wishes remaining`:'Three wishes per account. Everyone is welcome to read.')}</p>
    {model.state==='loading'&&<p role="status">{t("Gathering wishes…")}</p>}
    {model.state==='empty'&&<p>{t("The sky is waiting for its first wish.")}</p>}
    {(model.error||model.quotaError)&&<div className="wish-error" role="alert"><p>{t(model.error||model.quotaError)}</p><button className="text-button" onClick={()=>{if(model.error)model.retry();if(model.quotaError)model.loadQuota();}}>{t("Try again")}</button></div>}
    {notice&&<p role="status" className="wish-notice">{t(notice)}</p>}
   </div>
  </section><p className="balloon-credit">{t("A shared sky of hope")}</p></div>
  {model.release&&!reduced&&<div key={model.release.id} className="wish-release slow-release-caption" aria-hidden="true"><div className="release-caption">{t("Your wish is taking flight.")}</div></div>}
  {reading&&<Dialog title={t("A little light, just for you")} className="wish-reading-dialog" onClose={()=>setReading(null)}><div className="wish-reading"><WishLantern/><p className="wish-message">{reading.wish.message}</p><button className="text-button" onClick={async()=>{const index=reading.index<0?0:reading.index;const wish=await model.rotate(index);if(wish)setReading({wish,index});}}>{t("Read another wish")}</button></div></Dialog>}
  {compose&&<Dialog title={t("Send a little hope.")} className="wish-compose-dialog" locked={model.busy} onClose={()=>setCompose(false)}><form className="wish-form" onSubmit={async e=>{e.preventDefault();setFormError('');try{const wish=await model.submit(draft.trim());if(wish){setCompose(false);setDraft('');setNotice('Your lantern is rising gently. Your wish has joined the sky.');}}catch(error){setFormError(error.message);}}}>
    <div className="eyebrow">{t("YOUR LANTERN STARTS HERE")}</div><label htmlFor="wish-message">{t("Your wish")}</label><textarea id="wish-message" value={draft} rows={4} required placeholder={t("What would you like to send into the sky?")} onChange={e=>setDraft(e.target.value)} disabled={model.busy||!session}/>
    <p className="wish-form-note">{t("Your wish will be public: everyone can read it. Your name and the time are not displayed.")}</p>
    {remaining===0&&<p role="status">{t("You have released all three wishes.")}</p>}
    {model.quotaError&&<p className="inline-error" role="alert">{t(model.quotaError)}</p>}
    {formError&&<p className="inline-error" role="alert">{t(formError)}</p>}
    {model.uncertain&&<div className="wish-uncertain"><p>{t("Your release may have succeeded. ")}{t(remaining===undefined?'Check your allowance.':`${remaining} wishes remain.`)}{t(" Check the sky before sending the same wish again.")}</p><button type="button" className="btn secondary" disabled={model.busy} onClick={model.acknowledgeUncertain}>{t("I understand — check remaining wishes")}</button></div>}
    <button className="btn primary" type="submit" disabled={!session||model.busy||!remaining||model.uncertain||!draft.trim()}>{t(model.busy?'Releasing your lantern…':'Release my lantern')}</button>
    {remaining===undefined&&<button type="button" className="text-button" onClick={model.loadQuota}>{t("Check remaining wishes")}</button>}
    <p className="wish-form-note">{t("Up to three wishes per account. Your message joins the public sky.")}</p>
  </form></Dialog>}
 </div>;
}
