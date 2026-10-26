import { useEffect, useState } from 'react';
import { request, privateImage } from './api.js';
import ConfirmDialog from './ConfirmDialog.jsx';
function PendingPhoto({ photo, token, onReview, onDelete, busy, staff }) {
  const [src, setSrc] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let url = '';
    privateImage(`/admin/memory-photos/${photo.id}/image`, { token, signal: controller.signal }).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setSrc(url);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [photo.id, token]);
  const canApprove = staff?.permissions?.includes('memory.approve'), canReject = staff?.permissions?.includes('memory.reject'), canDelete = staff?.permissions?.includes('memory.delete');
  return <article className={`control-card memory-review-card memory-review-${photo.status.toLowerCase()}`}>
    <div className="memory-review-media">{src ? <img src={src} alt={`${photo.status.toLowerCase()} festival memory`}/> : <p role={error ? 'alert' : 'status'}>{error || 'Loading private photo…'}</p>}</div>
    <div className="memory-review-meta"><span className={`memory-status memory-status-${photo.status.toLowerCase()}`}>{photo.status}</span><time dateTime={photo.createdAt}>Submitted {new Date(photo.createdAt).toLocaleDateString()}</time></div>
    <div className="control-actions memory-review-actions">
      {photo.status === 'PENDING' && <><button className="button primary" disabled={busy || !src || !canApprove} onClick={() => onReview(photo.id, 'APPROVED')}>Approve</button><button className="button delete" disabled={busy || !src || !canReject} onClick={() => onReview(photo.id, 'REJECTED')}>Reject</button></>}
      {photo.status === 'APPROVED' && <><button className="button secondary" disabled={!src} onClick={() => src && window.open(src, '_blank', 'noopener,noreferrer')}>View image</button><button className="button delete" disabled={busy || !canDelete} onClick={() => onDelete(photo.id)}>Remove</button></>}
      {photo.status === 'ARCHIVED' && <button className="button secondary" disabled={!src} onClick={() => src && window.open(src, '_blank', 'noopener,noreferrer')}>View private image</button>}
    </div>
  </article>;
}
export default function MemoryModeration({ token, staff, controls, report, notify }) {
  const [photos, setPhotos] = useState([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(null);
  async function refresh() { setLoading(true); try { const data = await request('/admin/memory-photos', { token }); setPhotos(data.photos); setError(''); } catch (e) { setError(e.message); report(e); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, [token]);
  async function review(id, status) {
    if (busy) return; setBusy(true);
    try { await request(`/admin/memory-photos/${id}/review`, { token, method: 'PATCH', body: { status } }); notify(status === 'APPROVED' ? 'Photo approved for the public gallery.' : 'Photo rejected.'); await refresh(); }
    catch (e) { setError(e.message); report(e); } finally { setBusy(false); }
  }
  async function remove(id) { if (busy) return; setBusy(true); try { await request(`/admin/memory-photos/${id}`, { token, method: 'DELETE', body: {} }); notify('Approved photo permanently removed.'); await refresh(); } catch (e) { setError(e.message); report(e); } finally { setBusy(false); } }
  return <div><div className="page-header"><div><p className="eyebrow">MEMORY ADMINISTRATOR</p><h1>Memory Photo <em>moderation</em></h1><p className="muted">Submissions are {controls?.memoryPhotosEnabled ? 'enabled' : 'disabled'}. Use the controls above to change access.</p></div><button className="button secondary" disabled={loading || busy} onClick={refresh}>Refresh photos</button></div>{error && <p className="message error" role="alert">{error}</p>}{loading ? <p role="status">Loading photos…</p> : !photos.length ? <div className="empty">No uploaded photos.</div> : <div className="control-grid">{photos.map(photo => <PendingPhoto key={photo.id} photo={photo} token={token} busy={busy} staff={staff} onReview={(id,status)=>setConfirm({kind:'review',id,status})} onDelete={id=>setConfirm({kind:'delete',id})}/>)}</div>}{confirm && <ConfirmDialog title={confirm.kind === 'delete' ? 'Remove approved photo?' : `${confirm.status === 'REJECTED' ? 'Reject' : 'Approve'} this photo?`} busy={busy} onCancel={() => setConfirm(null)} onConfirm={async () => { const action = confirm; setConfirm(null); if (action.kind === 'delete') await remove(action.id); else await review(action.id, action.status); }}><p>{confirm.kind === 'delete' ? 'The private image will be permanently deleted.' : confirm.status === 'REJECTED' ? 'The private image will be deleted and the student slot released after cleanup.' : 'This photo will become visible in the public gallery.'}</p></ConfirmDialog>}</div>;
}
