import { useEffect, useState } from 'react';
import { request, privateImage } from './api.js';
function PendingPhoto({ photo, token, onReview, busy }) {
  const [src, setSrc] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let url = '';
    privateImage(`/admin/memory-photos/${photo.id}/image`, { token, signal: controller.signal }).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setSrc(url);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [photo.id, token]);
  return <article className="control-card memory-review-card">{src ? <img src={src} alt="Submitted festival memory"/> : <p>{error || 'Loading private photo…'}</p>}<p className="small">Submitted {new Date(photo.createdAt).toLocaleString()}</p><div className="control-actions"><button className="button primary" disabled={busy || !src} onClick={() => onReview(photo.id, 'APPROVED')}>Approve photo</button><button className="button delete" disabled={busy} onClick={() => onReview(photo.id, 'REJECTED')}>Reject photo</button></div></article>;
}
export default function MemoryModeration({ token, controls, report, notify }) {
  const [photos, setPhotos] = useState([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function refresh() { setLoading(true); try { const data = await request('/admin/memory-photos', { token }); setPhotos(data.photos); setError(''); } catch (e) { setError(e.message); report(e); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, [token]);
  async function review(id, status) {
    if (busy) return; setBusy(true);
    try { await request(`/admin/memory-photos/${id}/review`, { token, method: 'PATCH', body: { status } }); notify(status === 'APPROVED' ? 'Photo approved for the public gallery.' : 'Photo rejected.'); await refresh(); }
    catch (e) { setError(e.message); report(e); } finally { setBusy(false); }
  }
  return <div><div className="page-header"><div><p className="eyebrow">HIGHER ADMINISTRATOR</p><h1>Memory Photo <em>moderation</em></h1><p className="muted">Submissions are {controls?.memoryPhotosEnabled ? 'enabled' : 'disabled'}. Change this in Event controls.</p></div><button className="button secondary" disabled={loading || busy} onClick={refresh}>Refresh pending photos</button></div>{error && <p className="message error" role="alert">{error}</p>}{loading ? <p role="status">Loading pending photos…</p> : !photos.length ? <div className="empty">No photos awaiting review.</div> : <div className="control-grid">{photos.map(photo => <PendingPhoto key={photo.id} photo={photo} token={token} busy={busy} onReview={review}/>)}</div>}</div>;
}
