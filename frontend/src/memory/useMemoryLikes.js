import { useEffect, useRef, useState } from 'react';
import { readStoredSession, writeStoredSession } from '../hooks/useFestival.js';

export function useMemoryLikes(api, ids, onResult, refresh) {
  const [token, setToken] = useState(() => readStoredSession()?.token || null);
  const [state, setState] = useState({ key: '', token: null, entries: {} });
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const generation = useRef(0), operations = useRef(new Map());
  const key = ids.join(',');
  const tokenNow = readStoredSession()?.token || null;
  useEffect(() => {
    const sync = () => setToken(readStoredSession()?.token || null);
    const timer = setInterval(sync, 250);
    window.addEventListener('festival-session-change', sync); window.addEventListener('storage', sync); window.addEventListener('focus', sync);
    return () => { clearInterval(timer); window.removeEventListener('festival-session-change', sync); window.removeEventListener('storage', sync); window.removeEventListener('focus', sync); };
  }, []);
  useEffect(() => {
    const version = ++generation.current, controller = new AbortController();
    operations.current.forEach(value => value.abort()); operations.current.clear();
    setState({ key, token, entries: {} });
    if (token && key) api.memoryPhotoLikeStates(token, key.split(','), { signal: controller.signal }).then(photos => {
      if (controller.signal.aborted || version !== generation.current || readStoredSession()?.token !== token) return;
      setState({ key, token, entries: Object.fromEntries(photos.map(photo => [photo.photoId, { liked: photo.liked }])) });
      if (photos.length !== key.split(',').length) setNotice('Some photos are no longer available. Refresh the gallery.');
    }).catch(error => {
      if (controller.signal.aborted || version !== generation.current || readStoredSession()?.token !== token) return;
      if (error.status === 401) { writeStoredSession(null); setToken(null); setNotice('Your session expired. Sign in again to like memories.'); }
      else setNotice(error.status === 403 ? 'Likes are unavailable for this account or the feature is closed.' : 'Heart states could not be loaded. Please try again.');
    });
    return () => { controller.abort(); generation.current++; operations.current.forEach(value => value.abort()); operations.current.clear(); };
  }, [api, key, token, retry]);
  const entries = state.key === key && state.token === tokenNow && token === tokenNow ? state.entries : {};
  async function toggle(id) {
    const entry = entries[id];
    if (!tokenNow || !entry || entry.busy || operations.current.has(id)) return;
    const version = generation.current, auth = tokenNow, controller = new AbortController();
    operations.current.set(id, controller);
    setState(previous => ({ ...previous, entries: { ...previous.entries, [id]: { ...entry, busy: true, pop: false } } }));
    const current = () => !controller.signal.aborted && generation.current === version && readStoredSession()?.token === auth;
    try {
      const result = await api.setMemoryPhotoLike(auth, id, !entry.liked, { signal: controller.signal });
      if (!current()) return;
      setState(previous => ({ ...previous, entries: { ...previous.entries, [id]: { liked: result.liked, pop: result.liked } } }));
      onResult(result); setNotice('');
    } catch (error) {
      if (!current()) return;
      setState(previous => { const next = { ...previous.entries }; delete next[id]; return { ...previous, entries: next }; });
      if (error.status === 401) { writeStoredSession(null); setToken(null); setNotice('Your session expired. Sign in again to like memories.'); }
      else { setNotice(error.status === 404 ? 'This photo is no longer available.' : error.status === 403 ? 'Likes are unavailable right now.' : 'Could not confirm your heart. Refreshing the gallery before trying again.'); refresh(); }
    } finally { if (operations.current.get(id) === controller) operations.current.delete(id); }
  }
  return { anonymous: !tokenNow, entries, notice, toggle, retry: () => { setNotice(''); setRetry(value => value + 1); } };
}
