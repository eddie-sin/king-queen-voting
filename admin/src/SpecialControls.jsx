import { useState } from 'react';
import { request } from './api.js';
export default function SpecialControls({kind,token,staff,controls,onSaved,report,notify}){
 const [busy,setBusy]=useState(false);
 const allowed=action=>staff?.role==='admin'||staff?.permissions?.includes(action);
 const open=kind==='memory'?controls?.memoryPhotosEnabled:controls?.lanternVotingOpen;
 async function run(action){if(busy||!controls)return;setBusy(true);try{const data=await request(`/admin/controls/${action}`,{token,method:'POST',body:{revision:controls.revision,operationId:crypto.randomUUID()}});onSaved(data);notify('Controls updated.');}catch(e){report(e);}finally{setBusy(false);}}
 const button=(action,label,disabled=false)=><button key={action} className="button secondary" disabled={!controls||busy||disabled||!allowed(action)} onClick={()=>run(action)}>{label}</button>;
 return <section className="control-card"><h2>{kind==='memory'?'Memory feature':'Lantern voting'}</h2><strong>{open?'Open':'Closed'}</strong><div className="control-actions">{button(`${kind}.open`,'Open',open||kind==='lantern'&&controls?.lanternAnnouncementOpen)}{button(`${kind}.close`,'Close',!open)}{kind==='lantern'&&<>{button('lantern.announce','Announce winner',open||controls?.lanternAnnouncementOpen)}{button('lantern.hide','Hide announcement',!controls?.lanternAnnouncementOpen)}</>}</div>{kind==='lantern'&&<p className="small">Close voting before announcing. Only a unique highest-voted lantern can win; a tie blocks announcement.</p>}</section>;
}
