import { useCallback, useEffect, useRef, useState } from 'react';
import { readStoredSession, writeStoredSession } from '../hooks/useFestival.js';

const blank = phase => ({ phase, photos: [], quota: null });
export function useMyMemories(api) {
  const [state, setState] = useState(() => blank(readStoredSession() ? 'loading' : 'anonymous'));
  const active = useRef(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const request = ++generation.current;
    const session = readStoredSession();
    if (!session) { setState(previous => blank(previous.phase === 'expired' ? 'expired' : 'anonymous')); return; }
    const token = session.token;
    const controller = new AbortController(); active.current = controller;
    setState(blank('loading'));
    const current = () => !controller.signal.aborted && request === generation.current && readStoredSession()?.token === token;
    try {
      const data = await api.myMemoryPhotos(token, { signal: controller.signal });
      if (current()) setState({ phase: 'ready', ...data });
    } catch (error) {
      if (!current()) return;
      if (error.status === 401) {
        writeStoredSession(null); setState(blank('expired'));
      } else if (error.status === 403) {
        // The same status can mean a disabled feature or an inactive account.
        // Reuse /auth/me to distinguish them; never infer this from error copy.
        try {
          await api.me(token);
          if (current()) setState(blank('disabled'));
        } catch (accountError) {
          if (!current()) return;
          if ([401, 403].includes(accountError.status)) {
            writeStoredSession(null); setState(blank(accountError.status === 401 ? 'expired' : 'forbidden'));
          } else setState(blank('error'));
        }
      } else setState(blank('error'));
    }
  }, [api]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('festival-session-change', refresh);
    return () => {
      generation.current++; active.current?.abort(); clearInterval(timer);
      window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh); window.removeEventListener('festival-session-change', refresh);
    };
  }, [refresh]);
  const mutate = async (action, id) => {
    const session = readStoredSession();
    if (!session) throw new Error('Please sign in again.');
    await api[action](session.token, id);
    await refresh();
  };
  return { ...state, refresh, archive: id => mutate('archiveMemoryPhoto', id), unarchive: id => mutate('unarchiveMemoryPhoto', id), remove: id => mutate('deleteMemoryPhoto', id) };
}
