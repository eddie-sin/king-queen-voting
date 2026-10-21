import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { imageSrc, request } from './api.js';
import Icon from './Icon.jsx';
import SchedulePanel from './Schedule.jsx';
import LanternManager from './LanternManager.jsx';

const initial = { fullName:'', nickname:'', batchNumber:'', category:'king', age:'', zodiacSign:'', bio:'', hobbiesAndInterests:[], contactNumber:'', isActive:true, imageUrls:[''] };
const toForm = (candidate) => candidate ? ({ fullName:candidate.fullName || '', nickname:candidate.nickname || '', batchNumber:candidate.batchNumber || '', category:candidate.category || 'king', age:candidate.age ?? '', zodiacSign:candidate.zodiacSign || '', bio:candidate.bio || '', hobbiesAndInterests:[...(candidate.hobbiesAndInterests || [])], contactNumber:candidate.contactNumber || '', isActive:candidate.isActive !== false, imageUrls:candidate.images?.length ? candidate.images : [''] }) : { ...initial, imageUrls:[''] };
const fmtDate = (value) => value ? new Intl.DateTimeFormat('en-GB', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Yangon' }).format(new Date(value)) + ' MMT' : '—';
function Field({ label, hint, children, wide, required, optional, plain }) { const Tag = plain ? 'div' : 'label'; return <Tag className={`field ${wide ? 'wide' : ''} ${required ? 'req' : ''} ${optional ? 'opt' : ''}`}><span>{label}{required && <b className="req-star" aria-label="required">*</b>}{optional && <em className="opt-tag">(optional)</em>}</span>{children}{hint && <small>{hint}</small>}</Tag>; }
function Thumb({ src, alt='' }) {return src ? <img className="thumbnail" src={imageSrc(src)} alt={alt} onError={(e)=>{e.currentTarget.style.visibility='hidden';}}/> : <div className="thumbnail fallback"><Icon name="image" size={26}/></div>;}

const SESSION_KEY = 'thadingyut_admin_session';
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.token ? { token: String(parsed.token), username: String(parsed.username || 'Admin') } : { token: '', username: '' };
  } catch {
    return { token: '', username: '' };
  }
}
function saveSession(token, username) {
  try {
    if (token) localStorage.setItem(SESSION_KEY, JSON.stringify({ token, username }));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

export default function App() {
  const [token,setToken] = useState(()=>loadSession().token); const [username,setUsername] = useState(()=>loadSession().username);
  const [credentials,setCredentials] = useState({ username:'', password:'' }); const [loginBusy,setLoginBusy]=useState(false); const [showPw,setShowPw]=useState(false);
  const [candidates,setCandidates]=useState([]); const [schedule,setSchedule]=useState(null); const [loading,setLoading]=useState(false);
  const [error,setError]=useState(''); const [notice,setNotice]=useState(''); const [tab,setTab]=useState('all'); const [search,setSearch]=useState('');
  const [editor,setEditor]=useState(null); const [form,setForm]=useState(toForm(null)); const [photos,setPhotos]=useState([]);
  const [saving,setSaving]=useState(false); const [confirm,setConfirm]=useState(null); const [detail,setDetail]=useState(null); const [step,setStep]=useState(0); const [view,setView]=useState('candidates');
  const locked=Boolean(schedule?.candidateManagementLocked);
  const notify=(message)=>{setNotice(message);setError('');};
  const clearAuth=()=>{saveSession('','');setToken('');setUsername('');setEditor(null);setConfirm(null);setDetail(null);};
  const report=(e)=>{ setError(e.message || 'Unexpected error.'); setNotice(''); if(e.status===401 || e.status===403)clearAuth(); };
  async function refresh(auth=token){if(!auth)return;setLoading(true);setError('');try { const [people, settings]=await Promise.all([request('/admin/candidates',{token:auth}),request('/admin/settings',{token:auth})]);setCandidates(people.candidates || []);setSchedule(settings.schedule); } catch(e){report(e);} finally{setLoading(false);} }
  useEffect(()=>{if(token)refresh(token);},[token]);
  async function login(e){e.preventDefault();setLoginBusy(true);setError('');try{const data=await request('/auth/admin/login',{method:'POST',body:credentials});const user=data.admin?.username || credentials.username;saveSession(data.token,user);setUsername(user);setToken(data.token);setCredentials({username:'',password:''});setShowPw(false);notify('Signed in to administration.');}catch(e){report(e);}finally{setLoginBusy(false);}}
  const visible=useMemo(()=>candidates.filter(c=>(tab==='all'||c.category===tab)&&`${c.fullName} ${c.nickname || ''} ${c.batchNumber || ''}`.toLowerCase().includes(search.toLowerCase())),[candidates,tab,search]);
  function openEditor(c=null){setEditor(c?c._id:'new');setForm(toForm(c));setPhotos(initPhotos(c));setStep(0);setError('');}
  function closeEditor(){photos.forEach(p=>p.preview&&URL.revokeObjectURL(p.preview));setEditor(null);setPhotos([]);}
  const editingCandidate=editor==='new'?null:candidates.find(c=>c._id===editor);
  // Fields travel as one JSON value so lists, numbers and booleans keep their types.
  const multipart=(data,files)=>{const body=new FormData();body.append('data',JSON.stringify(data));files.forEach(file=>body.append('images',file));return body;};
  function buildBody(){
    if(!form.fullName.trim())throw new Error('Candidate full name is required.');
    if(photos.length<1||photos.length>3)throw new Error('Add between 1 and 3 photos.');
    if(form.age!==''&&(!Number.isInteger(Number(form.age))||Number(form.age)<1))throw new Error('Age must be a positive whole number.');
    const fields={ fullName:form.fullName.trim(), nickname:form.nickname.trim(), batchNumber:form.batchNumber.trim(), category:form.category, bio:form.bio.trim(), zodiacSign:form.zodiacSign.trim(), hobbiesAndInterests:form.hobbiesAndInterests, contactNumber:form.contactNumber.trim(), isActive:editor==='new'?true:Boolean(form.isActive) };
    if(form.age!=='')fields.age=Number(form.age); else if(editingCandidate?.age != null)fields.age=null;
    const newFiles=photos.filter(photo=>photo.file).map(photo=>photo.file);
    if(editor==='new')return multipart(fields,newFiles);
    // Editing: only new files are uploaded; current photos are kept by URL, in the chosen order.
    const original=editingCandidate?.images||[];
    const unchanged=!newFiles.length&&photos.length===original.length&&photos.every((photo,i)=>photo.url===original[i]);
    if(unchanged)return fields;
    let next=0;
    const photoLayout=photos.map(photo=>photo.file?{upload:next++}:{keep:photo.url});
    return newFiles.length?multipart({...fields,photoLayout},newFiles):{...fields,photoLayout};
  }
  async function save(e){e.preventDefault();if(locked)return;setSaving(true);setError('');try{const body=buildBody();const data=await request(editor==='new'?'/candidates':`/candidates/${editor}`,{token,method:editor==='new'?'POST':'PATCH',body});closeEditor();const failed=data?.storageCleanup?.failed||0;notify(editor==='new'?'Candidate created successfully.':failed?`Candidate saved, but ${failed} old photo${failed>1?'s':''} could not be deleted from storage.`:'Candidate details saved.');await refresh();}catch(e){report(e);}finally{setSaving(false);}}
  async function action(){if(!confirm)return;setSaving(true);setError('');try{if(confirm.kind==='delete'){await request(`/candidates/${confirm.candidate._id}`,{token,method:'DELETE'});notify('Candidate deleted.');}else{await request(`/candidates/${confirm.candidate._id}`,{token,method:'PATCH',body:{isActive:!confirm.candidate.isActive}});notify(`Candidate ${confirm.candidate.isActive?'deactivated':'activated'}.`);}setConfirm(null);await refresh();}catch(e){setConfirm(null);report(e);}finally{setSaving(false);}}
  const basicsOk=Boolean(form.fullName.trim()&&form.category);
  const photosOk=photos.length>0;
  const update=(field,value)=>setForm(current=>({...current,[field]:value}));
  // Object URL cleanup for new photos is handled in PhotoList and closeEditor; avoid persistent object URLs in form state.
  const messages=<>{error&&<div className="message error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}{notice&&<div className="message success" role="status">{notice}<button aria-label="Dismiss message" onClick={()=>setNotice('')}>×</button></div>}</>;
  if(!token)return <div className="login-page"><div className="stars"/><div className="login-shell"><div className="brand-mark"><Icon name="crown" size={27}/></div><p className="eyebrow">THADINGYUT · FESTIVAL OF LIGHTS</p><h1>Event Info &amp; <em>Candidate Management.</em></h1><p className="muted centered">A private workspace to manage your festival's event info and candidates.</p><form className="login-card" onSubmit={login}><div className="login-card-heading"><Icon name="shield"/><span>ADMINISTRATOR ACCESS</span></div><Field label="Admin username"><input autoComplete="username" value={credentials.username} onChange={e=>setCredentials({...credentials,username:e.target.value})} required placeholder="Enter your username"/></Field><Field label="Password"><div className="pw-wrap"><input type={showPw?'text':'password'} autoComplete="current-password" value={credentials.password} onChange={e=>setCredentials({...credentials,password:e.target.value})} required placeholder="Enter your password"/><button type="button" className="pw-toggle" aria-label={showPw?'Hide password':'Show password'} aria-pressed={showPw} onClick={()=>setShowPw(v=>!v)}><Icon name={showPw?'eyeOff':'eye'} size={18}/></button></div></Field>{error&&<div role="alert" className="message error">{error}</div>}<button className="button primary full" disabled={loginBusy}>{loginBusy?'Signing in…':'Enter admin workspace →'}</button><p className="small centered muted">Restricted to authorized festival administrators.</p></form><p className="login-foot">No account registration is available here.</p></div></div>;
  return <div className="admin-app"><aside className="sidebar"><div className="brand"><span className="brand-icon"><Icon name="crown" size={24}/></span><div><strong>THADINGYUT</strong><small>ADMIN WORKSPACE</small></div></div><div className="side-label">MANAGEMENT</div><nav className="side-nav" aria-label="Admin sections"><button type="button" title="Candidates" className={`side-link ${view==='candidates'?'active':''}`} aria-current={view==='candidates'?'page':undefined} onClick={()=>setView('candidates')}><Icon name="users"/><span className="side-text">Candidates</span><span className="side-count">{candidates.length}</span></button><button type="button" title="Election schedule" className={`side-link ${view==='schedule'?'active':''}`} aria-current={view==='schedule'?'page':undefined} onClick={()=>setView('schedule')}><Icon name="calendar"/><span className="side-text">Election schedule</span></button><button type="button" title="Lanterns" className={`side-link ${view==='lanterns'?'active':''}`} aria-current={view==='lanterns'?'page':undefined} onClick={()=>setView('lanterns')}><Icon name="image"/><span className="side-text">Lanterns</span></button></nav><div className="sidebar-bottom"><div className="admin-account"><span className="avatar">{username.slice(0,1).toUpperCase()}</span><div><strong>{username}</strong><small>Administrator</small></div></div><button className="logout" onClick={()=>{clearAuth();setView('candidates');setCandidates([]);setSchedule(null);setNotice('');setError('');}}><Icon name="logout" size={17}/> Sign out</button></div></aside>
  {view==='lanterns'?<LanternManager token={token}/>:<div className="workspace"><header className="topbar"><span>Festival Management <span className="breadcrumb">/ {view==='schedule'?'Election schedule':'Candidates'}</span></span><span className="secure"><Icon name="shield" size={15}/> Secured workspace</span></header><main className="content">{view==='schedule'?<SchedulePanel schedule={schedule} token={token} loading={loading} onSaved={setSchedule} report={report} notify={notify} messages={messages}/>:<><div className="page-header"><div><p className="eyebrow">FESTIVAL ADMINISTRATION · 2026</p><h1>Candidate <em>Management</em></h1><p className="muted">Manage the people behind the crowns, all in one place.</p></div><button className="button primary" disabled={locked||loading} onClick={()=>openEditor()}><Icon name="plus" size={18}/> Add candidate</button></div>
  {schedule&&<div className={`status-banner ${locked?'locked':'open'}`}><Icon name={locked?'lock':'shield'} size={20}/><div><strong>{locked?'Candidate management is closed':'Candidate management is open'}</strong><p>{locked?`The candidate management deadline (${fmtDate(schedule.candidateManagementClosesAt)}) has passed. You can extend it (up to Voting Start) in the Election schedule tab.`:`Candidate changes are open until ${fmtDate(schedule.candidateManagementClosesAt)}.`}</p></div></div>}
  {messages}
  <section className="stats"><div className="stat"><span>Total candidates</span><strong>{candidates.length}</strong><small>All registered candidates</small></div><div className="stat"><span>King candidates</span><strong>{candidates.filter(c=>c.category==='king').length}</strong><small>King category</small></div><div className="stat"><span>Queen candidates</span><strong>{candidates.filter(c=>c.category==='queen').length}</strong><small>Queen category</small></div><div className="stat"><span>Active profiles</span><strong>{candidates.filter(c=>c.isActive).length}</strong><small>Visible on public website</small></div></section>
  <section className="candidate-panel"><div className="panel-head"><div><h2>All candidates</h2><p className="muted small">Review, update, or manage profiles.</p></div><button className="icon-button" onClick={()=>refresh()} disabled={loading} aria-label="Refresh candidates" title="Refresh"><Icon name="refresh"/></button></div><div className="toolbar"><div className="tabs" role="group" aria-label="Candidate category">{[['all','All'],['king','Kings'],['queen','Queens']].map(([id,label])=><button key={id} className={tab===id?'selected':''} onClick={()=>setTab(id)}>{label}</button>)}</div><div className="search"><Icon name="search" size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or batch…" aria-label="Search candidates"/></div></div>
  {loading?<div className="empty">Loading candidates…</div>:visible.length===0?<div className="empty"><Icon name="users" size={35}/><h3>No candidates found</h3><p>{candidates.length?'Try a different search or filter.':'Add your first candidate to begin.'}</p></div>:<div className="table-wrap"><table><thead><tr><th>CANDIDATE</th><th>CATEGORY</th><th>BATCH</th><th>STATUS</th><th className="right">ACTIONS</th></tr></thead><tbody>{visible.map(c=><tr key={c._id} className="row-link" onClick={()=>setDetail(c)}><td><button className="candidate-cell" onClick={()=>setDetail(c)}><Thumb src={c.images?.[0]} alt={c.fullName}/><span><strong>{c.fullName}</strong><small>{c.nickname || 'View profile'}</small></span></button></td><td><span className="category-label">{c.category==='king'?'♛':'♕'} {c.category}</span></td><td>{c.batchNumber||'—'}</td><td><span className={`pill ${c.isActive?'active':'inactive'}`}><i/>{c.isActive?'Active':'Inactive'}</span></td><td onClick={e=>e.stopPropagation()}><div className="actions"><button className="icon-button" title="View details" aria-label={`View ${c.fullName}`} onClick={()=>setDetail(c)}><Icon name="eye" size={17}/></button><button disabled={locked} className="icon-button" title="Edit" aria-label={`Edit ${c.fullName}`} onClick={()=>openEditor(c)}><Icon name="edit" size={17}/></button><button disabled={locked} className="text-action" onClick={()=>setConfirm({kind:'toggle',candidate:c})}>{c.isActive?'Deactivate':'Activate'}</button><button disabled={locked} className="icon-button danger" title="Delete" aria-label={`Delete ${c.fullName}`} onClick={()=>setConfirm({kind:'delete',candidate:c})}><Icon name="trash" size={17}/></button></div></td></tr>)}</tbody></table></div>}</section>
  <p className="footnote">Profiles marked inactive are hidden from public candidate pages. Admin-only contact information never appears in the public API.</p></>}</main></div>}
  {editor!==null&&<div className="overlay center" onMouseDown={e=>{if(e.target===e.currentTarget&&!saving)closeEditor();}}><section className="modal wizard" role="dialog" aria-modal="true" aria-labelledby="editor-title"><header className="wizard-head"><div><p className="eyebrow">CANDIDATE PROFILE</p><h2 id="editor-title">{editor==='new'?'Add a candidate':'Edit candidate'}</h2></div><button className="icon-button" onClick={closeEditor} aria-label="Close"><Icon name="x"/></button></header>
  <ol className="steps">{['Basics','About','Photos'].map((label,i)=><li key={label} className={`${step===i?'current':''} ${i<step?'done':''}`}><button type="button" onClick={()=>{if(i<=step||basicsOk)setStep(i);}}><span className="step-num">{i<step?'✓':i+1}</span>{label}</button></li>)}</ol>
  <form onSubmit={e=>{e.preventDefault();if(step<2){if(step===0&&!basicsOk)return;setStep(step+1);}else save(e);}} className="wizard-form"><div className="wizard-scroll">
  {step===0&&<div className="form-grid"><Field label="Full name" required wide><input value={form.fullName} onChange={e=>update('fullName',e.target.value)} required maxLength={180} autoFocus/></Field><Field label="Nickname" optional><input value={form.nickname} onChange={e=>update('nickname',e.target.value)}/></Field><Field label="Batch number" optional><input value={form.batchNumber} onChange={e=>update('batchNumber',e.target.value)}/></Field><Field label="Category" required><select value={form.category} onChange={e=>update('category',e.target.value)}><option value="king">King</option><option value="queen">Queen</option></select></Field><Field label="Age" optional><input type="number" min="1" step="1" value={form.age} onChange={e=>update('age',e.target.value)}/></Field><Field label="Zodiac sign" optional plain><ZodiacSelect value={form.zodiacSign} onChange={v=>update('zodiacSign',v)}/></Field><Field label="Contact number" optional hint="Private, admin only"><input value={form.contactNumber} onChange={e=>update('contactNumber',e.target.value)}/></Field></div>}
  {step===1&&<div className="form-grid"><Field label="Hobbies & interests" optional wide plain hint="Type one and press Enter to add it"><HobbyInput value={form.hobbiesAndInterests} onChange={v=>update('hobbiesAndInterests',v)}/></Field><Field label="Biography" optional wide><textarea rows={8} value={form.bio} onChange={e=>update('bio',e.target.value)} placeholder="Introduce this candidate…"/></Field></div>}
  {step===2&&<Field label="Candidate photos" required plain hint="JPG, PNG or WebP · 5 MB maximum each · the first photo is the cover"><PhotoList photos={photos} setPhotos={setPhotos} setError={setError}/></Field>}
  {error&&<div className="message error" role="alert">{error}</div>}
  </div><div className="drawer-actions wizard-actions">{step===0?<button type="button" className="button secondary" onClick={closeEditor}>Cancel</button>:<button type="button" className="button secondary" onClick={()=>setStep(step-1)}>← Back</button>}{step<2?<button type="submit" className="button primary" disabled={step===0&&!basicsOk}>Next →</button>:<button type="submit" disabled={saving||locked||!photosOk} className="button primary">{saving?'Saving…':editor==='new'?'Create candidate':'Save changes'}</button>}</div></form></section></div>}
  {detail&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null);}}><section role="dialog" aria-modal="true" aria-label="Candidate profile" className="modal"><button className="modal-close icon-button" onClick={()=>setDetail(null)} aria-label="Close"><Icon name="x"/></button><p className="eyebrow">{detail.category.toUpperCase()} CANDIDATE</p><h2>{detail.fullName}</h2>{detail.nickname&&<p className="muted">{detail.nickname}</p>}<div className="profile-photos">{detail.images?.map((src,i)=><Thumb key={i} src={src} alt={`Candidate photo ${i+1}`}/>)}</div><dl className="profile-data">{[['Batch',detail.batchNumber],['Age',detail.age],['Zodiac',detail.zodiacSign],['Interests',detail.hobbiesAndInterests?.join(', ')],['Contact (admin only)',detail.contactNumber],['Visibility',detail.isActive?'Active':'Inactive']].map(([key,val])=><div key={key}><dt>{key}</dt><dd>{val||'—'}</dd></div>)}</dl>{detail.bio&&<p className="bio">{detail.bio}</p>}<div className="drawer-actions"><button className="button secondary" onClick={()=>setDetail(null)}>Close</button><button className="button primary" disabled={locked} onClick={()=>{setDetail(null);openEditor(detail);}}>Edit profile</button></div></section></div>}
  {confirm&&<div className="overlay"><section role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" className="modal small-modal"><div className="warning-symbol"><Icon name={confirm.kind==='delete'?'trash':'shield'} size={25}/></div><h2 id="confirmation-title">{confirm.kind==='delete'?'Delete this candidate?':`${confirm.candidate.isActive?'Deactivate':'Activate'} this candidate?`}</h2><p className="muted">{confirm.kind==='delete'?`This permanently deletes ${confirm.candidate.fullName}'s candidate record. This cannot be undone.`:`${confirm.candidate.fullName} will be ${confirm.candidate.isActive?'hidden from':'visible on'} the public candidate website.`}</p><div className="drawer-actions"><button className="button secondary" onClick={()=>setConfirm(null)} disabled={saving}>Cancel</button><button className={`button ${confirm.kind==='delete'?'delete':'primary'}`} onClick={action} disabled={saving||locked}>{saving?'Please wait…':confirm.kind==='delete'?'Delete candidate':'Confirm change'}</button></div></section></div>}
  </div>;
}
const ZODIACS=[['Aries','♈'],['Taurus','♉'],['Gemini','♊'],['Cancer','♋'],['Leo','♌'],['Virgo','♍'],['Libra','♎'],['Scorpio','♏'],['Sagittarius','♐'],['Capricorn','♑'],['Aquarius','♒'],['Pisces','♓']];
const initPhotos=(c)=>(c?.images||[]).slice(0,3).map(url=>({url}));
function ZodiacSelect({ value, onChange }){
  const [text,setText]=useState(value||''); const [open,setOpen]=useState(false); const [hi,setHi]=useState(0); const [pos,setPos]=useState(null);
  const inputRef=useRef(null);
  useEffect(()=>{setText(value||'');},[value]);
  const q=text.trim().toLowerCase(); const filtering=q&&text!==value;
  const shown=filtering?ZODIACS.filter(([name])=>name.toLowerCase().includes(q)):ZODIACS;
  const current=ZODIACS.find(([name])=>name===value);
  useLayoutEffect(()=>{
    if(!open)return;
    // Rendered in a portal so the modal's scroll area can't clip it; flips upward when space below is short.
    const place=()=>{
      const r=inputRef.current?.getBoundingClientRect(); if(!r)return;
      const width=Math.min(Math.max(r.width,390),window.innerWidth-16);
      const left=Math.min(Math.max(8,r.left),window.innerWidth-width-8);
      const below=window.innerHeight-r.bottom-12, above=r.top-12;
      setPos(below<200&&above>below?{left,width,bottom:window.innerHeight-r.top+6,maxHeight:above}:{left,width,top:r.bottom+6,maxHeight:below});
    };
    place(); window.addEventListener('resize',place); window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);
  const pick=(name)=>{onChange(name);setText(name);setOpen(false);};
  const settle=()=>{const exact=ZODIACS.find(([name])=>name.toLowerCase()===q);if(exact)pick(exact[0]);else{setText(value||'');setOpen(false);}};
  const onKey=(e)=>{
    if(e.key==='ArrowDown'){e.preventDefault();if(!open){setOpen(true);return;}setHi(h=>Math.min(h+1,shown.length-1));}
    else if(e.key==='ArrowUp'){e.preventDefault();setHi(h=>Math.max(h-1,0));}
    else if(e.key==='Enter'&&open&&shown[hi]){e.preventDefault();pick(shown[hi][0]);}
    else if(e.key==='Escape'&&open){e.stopPropagation();setText(value||'');setOpen(false);}
  };
  const showSym=current&&text===value;
  return <div className="combo">
    {showSym&&<span className="zsym combo-sym" aria-hidden="true">{current[1]+'\uFE0E'}</span>}
    <input ref={inputRef} className={showSym?'has-sym':''} role="combobox" aria-expanded={open} aria-label="Zodiac sign" autoComplete="off" value={text} placeholder="Type or choose a sign" onFocus={()=>{setOpen(true);setHi(0);}} onClick={()=>setOpen(true)} onChange={e=>{setText(e.target.value);setOpen(true);setHi(0);}} onKeyDown={onKey} onBlur={settle}/>
    {value&&<button type="button" className="combo-clear" aria-label="Clear zodiac sign" onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange('');setText('');}}><Icon name="x" size={14}/></button>}
    {open&&pos&&createPortal(<div className="combo-pop" role="listbox" style={pos} onMouseDown={e=>e.preventDefault()}>{shown.length?shown.map(([name,symbol],i)=><div key={name} role="option" aria-selected={name===value} className={`zopt ${i===hi?'hi':''} ${name===value?'sel':''}`} onMouseEnter={()=>setHi(i)} onClick={()=>pick(name)}><span className="zsym">{symbol+'\uFE0E'}</span>{name}</div>):<div className="combo-empty">No matching sign</div>}</div>,document.body)}
  </div>;
}
function HobbyInput({ value, onChange }){
  const [text,setText]=useState('');
  const add=(raw)=>{const next=[...value];raw.split(',').map(x=>x.trim()).filter(Boolean).forEach(item=>{if(!next.some(x=>x.toLowerCase()===item.toLowerCase()))next.push(item);});onChange(next);setText('');};
  return <div className="chips-box">{value.map(item=><span className="chip" key={item}>{item}<button type="button" aria-label={`Remove ${item}`} onClick={()=>onChange(value.filter(x=>x!==item))}><Icon name="x" size={12}/></button></span>)}
    <input aria-label="Add a hobby or interest" value={text} placeholder={value.length?'Add another…':'e.g. Dancing'} autoFocus onChange={e=>{if(e.target.value.includes(','))add(e.target.value);else setText(e.target.value);}} onKeyDown={e=>{if(e.key==='Enter'&&text.trim()){e.preventDefault();add(text);}else if(e.key==='Backspace'&&!text&&value.length)onChange(value.slice(0,-1));}} onBlur={()=>{if(text.trim())add(text);}}/></div>;
}
const PHOTO_TYPES=['image/jpeg','image/png','image/webp'];
// A real button that opens a hidden file chooser, so it also works with the keyboard.
function FilePick({ onPick, className, label, children }){
  const input=useRef(null);
  return <><button type="button" className={className} aria-label={label} onClick={()=>input.current?.click()}>{children}</button><input ref={input} type="file" accept={PHOTO_TYPES.join(',')} hidden onChange={e=>{onPick(e.target.files?.[0]);e.target.value='';}}/></>;
}
function PhotoList({ photos, setPhotos, setError }){
  const accept=(file)=>{
    if(!file)return false;
    if(!PHOTO_TYPES.includes(file.type)||file.size>5*1024*1024){setError('Photos must be JPG, PNG or WebP, 5 MB at most.');return false;}
    setError('');return true;
  };
  const fresh=(file)=>({file,preview:URL.createObjectURL(file)});
  const release=(photo)=>{if(photo?.preview)URL.revokeObjectURL(photo.preview);};
  const add=(file)=>{if(photos.length<3&&accept(file))setPhotos([...photos,fresh(file)]);};
  const replace=(index,file)=>{if(!accept(file))return;release(photos[index]);setPhotos(photos.map((photo,i)=>i===index?fresh(file):photo));};
  const remove=(index)=>{release(photos[index]);setPhotos(photos.filter((_,i)=>i!==index));};
  const makeCover=(index)=>setPhotos([photos[index],...photos.filter((_,i)=>i!==index)]);
  return <div className="photo-row">
    {photos.map((photo,i)=><div className="photo-item" key={photo.preview||photo.url}>
      <img src={photo.preview||imageSrc(photo.url)} alt={`Photo ${i+1}`}/>
      {i===0&&<span className="slot-tag">Cover</span>}
      <button type="button" className="slot-remove" aria-label={`Remove photo ${i+1}`} onClick={()=>remove(i)}><Icon name="x" size={14}/></button>
      <div className="photo-actions">
        <FilePick className="photo-action" label={`Replace photo ${i+1}`} onPick={file=>replace(i,file)}><Icon name="refresh" size={13}/>Replace</FilePick>
        {i>0&&<button type="button" className="photo-action" aria-label={`Set photo ${i+1} as cover`} onClick={()=>makeCover(i)}><Icon name="crown" size={13}/>Cover</button>}
      </div>
    </div>)}
    {photos.length<3&&<FilePick className="photo-add" label="Add photo" onPick={add}><Icon name="plus" size={22}/><strong>{photos.length?'Add another':'Add photo'}</strong><span>{photos.length} of 3</span></FilePick>}
  </div>;
}
