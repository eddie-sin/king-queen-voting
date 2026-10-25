import { useEffect, useRef, useState } from 'react';
import { request } from './api.js';
export default function VoteTotals({kind='candidates',token}){
 const [snapshot,setSnapshot]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),locked=useRef(false);
 useEffect(()=>{generation.current++;setSnapshot(null);setError('');return()=>{generation.current++;};},[kind,token]);
 async function refresh(){if(locked.current)return;locked.current=true;const current=generation.current;setBusy(true);setError('');try{
  const data=await request(kind==='lanterns'?'/admin/lantern-vote-totals':'/admin/vote-totals',{token});
  if(current===generation.current)setSnapshot(data);
 }catch(e){if(current===generation.current){setSnapshot(null);setError(e.message);}}finally{locked.current=false;if(current===generation.current)setBusy(false);}}
 return <section className="candidate-panel" style={{margin:'24px 0'}}><div className="panel-head"><div><h2>{kind==='lanterns'?'Lantern':'Candidate'} vote totals</h2><p className="muted small">{snapshot?`Snapshot captured ${new Date(snapshot.capturedAt).toLocaleString()}`:'Press Refresh totals to load the current counts.'} These counts do not update automatically.</p></div><button className="button secondary" disabled={busy} onClick={refresh}>{busy?'Loading…':'Refresh totals'}</button></div>{error&&<p className="message error" role="alert">{error}</p>}{snapshot&&<div className="table-wrap"><table><thead><tr><th>{kind==='lanterns'?'Lantern':'Candidate'}</th>{kind!=='lanterns'&&<th>Category</th>}<th>Votes</th></tr></thead><tbody>{snapshot.entries.map(row=><tr key={(row.candidate||row.lantern)._id}><td>{row.candidate?.fullName||row.lantern?.title}</td>{kind!=='lanterns'&&<td>{row.candidate.category}</td>}<td>{row.votes}</td></tr>)}</tbody></table>{!snapshot.entries.length&&<p className="empty">No entries yet.</p>}</div>}</section>;
}
