import { useEffect, useState } from 'react';
import { request } from './api.js';
import { Spinner } from './Loader.jsx';
import { canAnnounceLantern, canLanternReset } from './specialControls.js';

const BUSY_LABELS = {
  'memory.open': 'Opening…',
  'memory.close': 'Closing…',
  'lantern.open': 'Opening…',
  'lantern.close': 'Closing…',
  'lantern.announce': 'Announcing…',
  'lantern.hide': 'Hiding…',
};

export default function SpecialControls({kind,token,staff,controls,onSaved,report,notify}){
 const [busy,setBusy]=useState('');
 const [confirmReset,setConfirmReset]=useState(false);
 const [winner,setWinner]=useState(null);
 const allowed=action=>staff?.role==='admin'||staff?.permissions?.includes(action);
 const open=kind==='memory'?controls?.memoryPhotosEnabled:controls?.lanternVotingOpen;
 useEffect(()=>{if(kind!=='lantern')return;let live=true;request('/lantern-voting').then(data=>{if(live)setWinner(data.winner||null);}).catch(()=>{if(live)setWinner(null);});return()=>{live=false;};},[kind,controls?.revision]);
 async function run(action){if(busy||!controls)return;setBusy(action);try{const data=await request(`/admin/controls/${action}`,{token,method:'POST',body:{revision:controls.revision,operationId:crypto.randomUUID()}});onSaved(data);notify(action==='lantern.votes.reset'?`Reset ${data.lanternVotesRemoved||0} Lantern vote${data.lanternVotesRemoved===1?'':'s'}.`:'Controls updated.');setConfirmReset(false);}catch(e){report(e);}finally{setBusy('');}}
 const button=(action,label,disabled=false)=><button key={action} className={`button secondary ${busy===action?'is-busy':''}`} disabled={!controls||Boolean(busy)||disabled||!allowed(action)} onClick={()=>run(action)}>{busy===action?<><Spinner size={14}/>{BUSY_LABELS[action]||'Updating…'}</>:label}</button>;
 return <><section className={`control-card ${busy?'is-busy':''}`} data-state={open?'open':'closed'} aria-busy={Boolean(busy)}><h2>{kind==='memory'?'Memory feature':'Lantern voting'}</h2><strong>{!controls?<><Spinner size={12}/>Checking…</>:open?'Open':'Closed'}</strong><div className="control-actions">{button(`${kind}.open`,'Open',open||kind==='lantern'&&controls?.lanternAnnouncementOpen)}{button(`${kind}.close`,'Close',!open)}{kind==='lantern'&&<>{button('lantern.announce','Announce winner',!canAnnounceLantern({controls,winner}))}{button('lantern.hide','Hide announcement',!controls?.lanternAnnouncementOpen)}{canLanternReset(staff)?<button className="button delete" disabled={!controls||Boolean(busy)||open||controls.lanternAnnouncementOpen} onClick={()=>setConfirmReset(true)}>Reset all votes</button>:null}</>}</div>{kind==='lantern'&&<p className="small">Close voting before announcing. Only a unique highest-voted lantern can win; a tie blocks announcement.</p>}{kind==='lantern'&&controls?.lanternAnnouncementOpen&&winner&&<div className="result-votes"><strong>Announced winner: {winner.lantern.title}</strong><span>{winner.votes} votes</span><img src={winner.lantern.url} alt={winner.lantern.title}/></div>}</section>{confirmReset&&<div className="overlay center"><section className="modal small-modal" role="alertdialog" aria-modal="true" aria-labelledby="lantern-reset-title"><div className="warning-symbol">!</div><h2 id="lantern-reset-title">Reset all Lantern votes?</h2><p className="muted">This permanently deletes every Lantern vote. Students can vote again after Lantern voting is reopened. Lantern images and other event data are kept.</p><div className="drawer-actions"><button className="button secondary" disabled={Boolean(busy)} onClick={()=>setConfirmReset(false)}>Cancel</button><button className="button delete" disabled={Boolean(busy)||open||controls?.lanternAnnouncementOpen} onClick={()=>run('lantern.votes.reset')}>{busy==='lantern.votes.reset'?<><Spinner size={14}/>Resetting…</>:'Reset all votes'}</button></div></section></div>}</>;
}
