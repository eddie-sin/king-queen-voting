import { useEffect, useState } from 'react';
import { imageSrc, request } from './api.js';
import { lanternFormData, lanternMetadata } from './lanterns.js';

const blank = { title: '', description: '' };
export default function LanternManager({ token }) {
  const [lanterns, setLanterns] = useState([]); const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null); const [form, setForm] = useState(blank); const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(null);
  async function refresh() { setLoading(true); try { const data = await request('/images?section=lantern', { token }); setLanterns(data.images || []); } catch (error) { setMessage({ type: 'error', text: error.message }); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, [token]);
  function open(lantern = null) { setEditor(lantern || 'new'); setForm(lantern ? { title: lantern.title || '', description: lantern.description || '' } : blank); setFiles([]); setMessage(null); }
  function close() { setEditor(null); setFiles([]); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      if (editor === 'new') await request('/images', { token, method: 'POST', body: lanternFormData(form, files) });
      else await request(`/images/${editor._id}`, { token, method: 'PATCH', body: lanternMetadata(form) });
      close(); setMessage({ type: 'success', text: editor === 'new' ? 'Lantern added.' : 'Lantern details updated.' }); await refresh();
    } catch (error) { setMessage({ type: 'error', text: error.message }); } finally { setBusy(false); }
  }
  async function remove(lantern) {
    if (!window.confirm(`Delete “${lantern.title || 'Festival lantern'}”?`)) return;
    setBusy(true); setMessage(null);
    try { await request(`/images/${lantern._id}`, { token, method: 'DELETE' }); setMessage({ type: 'success', text: 'Lantern deleted.' }); await refresh(); }
    catch (error) { setMessage({ type: 'error', text: error.message }); } finally { setBusy(false); }
  }
  return <div className="workspace"><header className="topbar"><span>Festival Management <span className="breadcrumb">/ Lanterns</span></span><span className="secure">Admin only</span></header><main className="content">
    <div className="page-header"><div><p className="eyebrow">FESTIVAL GALLERY</p><h1>Lantern <em>Images</em></h1><p className="muted">Share each lantern with its own title and story.</p></div><button className="button primary" onClick={()=>open()}>Add lantern</button></div>
    {message&&<div className={`message ${message.type}`} role={message.type==='error'?'alert':'status'}>{message.text}<button onClick={()=>setMessage(null)} aria-label="Dismiss">×</button></div>}
    <section className="candidate-panel"><div className="panel-head"><div><h2>Lantern gallery</h2><p className="muted small">Publicly visible festival content.</p></div><button className="button secondary" onClick={refresh} disabled={loading}>Refresh</button></div>
      {loading?<div className="empty">Loading lanterns…</div>:!lanterns.length?<div className="empty"><h3>No lanterns yet</h3><p>Add the first lantern image and story.</p></div>:<div className="lantern-admin-grid">{lanterns.map(lantern=><article className="lantern-admin-card" key={lantern._id}><img src={imageSrc(lantern.url)} alt={lantern.title || 'Festival lantern'}/><div><h3>{lantern.title || 'Untitled legacy lantern'}</h3><p>{lantern.description || 'No description provided.'}</p><div className="actions"><button className="button secondary" onClick={()=>open(lantern)}>Edit</button><button className="button delete" onClick={()=>remove(lantern)} disabled={busy}>Delete</button></div></div></article>)}</div>}
    </section>
  </main>{editor&&<div className="overlay" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)close();}}><section className="drawer" role="dialog" aria-modal="true" aria-labelledby="lantern-editor-title"><header className="drawer-header"><div><p className="eyebrow">LANTERN GALLERY</p><h2 id="lantern-editor-title">{editor==='new'?'Add lantern':'Edit lantern'}</h2></div><button className="icon-button" onClick={close} aria-label="Close">×</button></header><form className="drawer-body" onSubmit={save}><label className="field"><span>Title *</span><input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} required maxLength={120}/></label><label className="field"><span>Description</span><textarea rows={7} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} maxLength={1000}/><small>{form.description.length}/1000 characters</small></label>{editor==='new'&&<label className="upload-area"><strong>Choose one lantern image</strong><span>JPG, PNG or WebP · 5 MB maximum</span><input type="file" accept="image/jpeg,image/png,image/webp" required onChange={e=>setFiles(Array.from(e.target.files||[]).slice(0,1))}/></label>}<div className="drawer-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={busy}>{busy?'Saving…':editor==='new'?'Add lantern':'Save changes'}</button></div></form></section></div>}</div>;
}
