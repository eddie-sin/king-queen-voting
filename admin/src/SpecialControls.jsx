import { useState } from 'react';
import { request } from './api.js';
import { Spinner } from './Loader.jsx';

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
 const allowed=action=>staff?.role==='admin'||staff?.permissions?.includes(action);
 const open=kind==='memory'?controls?.memoryPhotosEnabled:controls?.lanternVotingOpen;
 async function run(action){if(busy||!controls)return;setBusy(action);try{const data=await request(`/admin/controls/${action}`,{token,method:'POST',body:{revision:controls.revision,operationId:crypto.randomUUID()}});onSaved(data);notify('Controls updated.');}catch(e){report(e);}finally{setBusy('');}}
 const button=(action,label,disabled=false)=><button key={action} className={`button secondary ${busy===action?'is-busy':''}`} disabled={!controls||Boolean(busy)||disabled||!allowed(action)} onClick={()=>run(action)}>{busy===action?<><Spinner size={14}/>{BUSY_LABELS[action]||'Updating…'}</>:label}</button>;
 return <section className={`control-card ${busy?'is-busy':''}`} data-state={open?'open':'closed'} aria-busy={Boolean(busy)}><h2>{kind==='memory'?'Memory feature':'Lantern voting'}</h2><strong>{!controls?<><Spinner size={12}/>Checking…</>:open?'Open':'Closed'}</strong><div className="control-actions">{button(`${kind}.open`,'Open',open||kind==='lantern'&&controls?.lanternAnnouncementOpen)}{button(`${kind}.close`,'Close',!open)}{kind==='lantern'&&<>{button('lantern.announce','Announce winner',open||controls?.lanternAnnouncementOpen)}{button('lantern.hide','Hide announcement',!controls?.lanternAnnouncementOpen)}</>}</div>{kind==='lantern'&&<p className="small">Close voting before announcing. Only a unique highest-voted lantern can win; a tie blocks announcement.</p>}</section>;
}
