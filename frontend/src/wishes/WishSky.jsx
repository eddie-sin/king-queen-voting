import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog.jsx';
import { wishLength, validWishText } from './wishText.js';
import { useWishSky } from './useWishSky.js';
import FireworkStation from './FireworkStation.jsx';
import WishSkyTour from './WishSkyTour.jsx';
import WishReaction from './WishReaction.jsx';
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
 return {capacity:small?8:24,reduced};
}
function ReleasedWish({release,launching,onArrive,onRead}){
 const [flight,setFlight]=useState(()=>makeFlightPath(true));
 const [inSky,setInSky]=useState(false);
 return <button className={`floating-wish newly-released-wish ${launching?'is-releasing':''} ${inSky?'is-in-sky':''}`} style={flight} aria-label="Read your released wish" disabled={launching} onClick={()=>onRead({wish:release.wish,index:-1})} onAnimationEnd={e=>{if(e.target!==e.currentTarget)return;if(e.animationName==='release-arrival')onArrive(release.id);else if(e.animationName==='released-wish-flight'){onArrive(release.id);setInSky(true);}}} onAnimationIteration={e=>{if(e.target===e.currentTarget&&e.animationName==='wish-natural-rise')setFlight(previous=>makeFlightPath(false,previous));}}><WishLantern/></button>;
}
export default function WishSky({api,session,onRequireLogin,accountOpen,paused}){
 const {capacity,reduced}=useSkyPreferences();const model=useWishSky(api,session,capacity);
 const moderationSeen=useRef(null);
 useEffect(()=>{if(moderationSeen.current!==null&&moderationSeen.current!==model.moderationRevision)setReading(null);moderationSeen.current=model.moderationRevision;},[model.moderationRevision]);
 const [compose,setCompose]=useState(false),[requested,setRequested]=useState(false),[reading,setReading]=useState(null),[draft,setDraft]=useState(''),[name,setName]=useState(''),[formError,setFormError]=useState('');
 const [tourOpen,setTourOpen]=useState(()=>{try{return localStorage.getItem('wish-sky-tour-v1')!=='done';}catch{return true;}});
 const [flightPaths,setFlightPaths]=useState(()=>Array.from({length:24},()=>makeFlightPath()));
 const [arrivedRelease,setArrivedRelease]=useState(null);
 const launching=Boolean(model.release&&!reduced&&arrivedRelease!==model.release.id);
 const composingAccount=useRef(session?.token);
 useEffect(()=>{const old=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=old;};},[]);
 useEffect(()=>{if(composingAccount.current!==session?.token){setDraft('');setName('');setCompose(false);setFormError('');composingAccount.current=session?.token;}},[session?.token]);
 useEffect(()=>{if(requested&&session&&!accountOpen){setRequested(false);setCompose(true);}},[requested,session,accountOpen]);
 useEffect(()=>{if(!requested||accountOpen||session)return;setRequested(false);},[requested,accountOpen,session]);
 const releaseButton=()=>{if(!session){setRequested(true);onRequireLogin();}else{setFormError('');setCompose(true);}};
 const finishTour=()=>{try{localStorage.setItem('wish-sky-tour-v1','done');}catch{}setTourOpen(false);};
 const remaining=model.quota?.remaining;
 const reroute=i=>setFlightPaths(paths=>paths.map((path,index)=>index===i?makeFlightPath(false,path):path));
 return <div className={`wish-world ${paused?'motion-paused':''} ${reading||compose||accountOpen?'wish-dialog-open':''}`}>
  <Atmosphere/>
  <div className="wish-world-content"><section className="wish-section" aria-label="Wish sky"><div className="free-sky-heading"><div className="eyebrow">LET A LITTLE HOPE TAKE FLIGHT</div><h2>A sky full of <em>wishes.</em></h2><p aria-live="polite">{model.total===null?'Gathering wishes…':`${model.total} ${model.total===1?'wish':'wishes'} in our shared sky`}</p></div>
   <div className="wish-sky" role="group" aria-label="Wishes drifting across the full sky"><div className="wish-lantern-grid">
    {tourOpen&&model.state!=='loading'&&model.slots.length===0&&<button className="floating-wish tutorial-sample-wish" aria-label="Read sample wish" onClick={()=>setReading({wish:{id:'tour-sample',message:'May every hope find its light.',reactions:0,reacted:false},index:-1})}><WishLantern/></button>}
    {model.slots.map((wish,i)=>model.release?.wish.id===wish.id?null:<button key={i} className="floating-wish" style={flightPaths[i]} aria-label={`Read wish ${i+1}`} onClick={()=>setReading({wish,index:i})} onAnimationIteration={e=>{if(e.target===e.currentTarget){reroute(i);model.rotate(i);}}}><WishLantern/></button>)}
    {model.release&&<ReleasedWish key={model.release.id} release={model.release} launching={launching} onArrive={setArrivedRelease} onRead={setReading}/>}
   </div></div>
   <div className="sky-actions"><button className="btn primary" onClick={releaseButton} disabled={model.busy}>{model.busy?'Releasing…':'Release a wish'}</button>
    <p className="wish-quota-note" aria-live="polite">{session?remaining??'…':3}/3</p>
    {(model.error||model.quotaError)&&<div className="wish-error" role="alert"><p>{model.error||model.quotaError}</p><button className="text-button" onClick={()=>{if(model.error)model.retry();if(model.quotaError)model.loadQuota();}}>Try again</button></div>}
   </div><FireworkStation/>
  </section><p className="balloon-credit">A shared sky of hope</p></div>
  {launching&&<div key={model.release.id} className="wish-release" aria-hidden="true"><div className="release-caption">Your wish is taking flight.</div></div>}
  {tourOpen&&model.state!=='loading'&&<WishSkyTour onDone={finishTour}/>}
  {reading&&<Dialog title="A little light, just for you" className="wish-reading-dialog" onClose={()=>setReading(null)}><div className="wish-reading"><WishLantern/><p className="wish-message">{reading.wish.message}</p>{reading.wish.name&&<p className="wish-signature">— <strong>{reading.wish.name}</strong></p>}{reading.wish.id!=='tour-sample'&&<WishReaction wish={reading.wish} onReact={async(wish,active)=>{const updated=await model.react(wish,active);setReading(previous=>previous?.wish.id===wish.id?{...previous,wish:updated}:previous);}}/>}</div></Dialog>}
  {compose&&<Dialog title="Send a little hope." className="wish-compose-dialog" locked={model.busy} onClose={()=>setCompose(false)}><form className="wish-form" onSubmit={async e=>{e.preventDefault();setFormError('');try{const wish=await model.submit(draft.trim(),name.trim());if(wish){setCompose(false);setDraft('');setName('');}}catch(error){setFormError(error.message);}}}>
    <div className="eyebrow">YOUR LANTERN STARTS HERE</div><label htmlFor="wish-message">Your wish</label><textarea id="wish-message" value={draft} rows={4} required placeholder="What would you like to send into the sky?" onChange={e=>setDraft(e.target.value)} disabled={model.busy||!session}/>
    <p className="wish-form-note" aria-live="polite">{wishLength(draft.trim())}/280 characters · up to 8 lines</p>
    {draft && !validWishText(draft) && <p role="alert">Keep your wish within 280 characters, 8 lines and 8 KB.</p>}
    <label htmlFor="wish-name">Your name <span className="optional-label">(optional)</span></label><input id="wish-name" value={name} maxLength={60} placeholder="Leave blank to stay anonymous" onChange={e=>setName(e.target.value)} disabled={model.busy||!session}/>
    <p className="wish-form-note">Everyone can read your wish. Your name appears only if you add it.</p>
    {model.postingOpen===false&&<p role="status">New wishes are paused. You can keep your draft and read the sky.</p>}
    {remaining===0&&<p role="status">You have released all three wishes.</p>}
    {model.quotaError&&<p className="inline-error" role="alert">{model.quotaError}</p>}
    {formError&&<p className="inline-error" role="alert">{formError}</p>}
    {model.uncertain&&<div className="wish-uncertain"><p>Your release may have succeeded. {remaining===undefined?'Check your allowance.':`${remaining} wishes remain.`} Check the sky before sending the same wish again.</p><button type="button" className="btn secondary" disabled={model.busy} onClick={model.acknowledgeUncertain}>I understand — check remaining wishes</button></div>}
    <button className="btn primary" type="submit" disabled={!session||model.busy||!remaining||model.uncertain||!validWishText(draft)||model.postingOpen===false}>{model.busy?'Releasing your lantern…':'Release my lantern'}</button>
    {remaining===undefined&&<button type="button" className="text-button" onClick={model.loadQuota}>Check remaining wishes</button>}
  </form></Dialog>}
 </div>;
}
