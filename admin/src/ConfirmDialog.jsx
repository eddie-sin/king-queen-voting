import { useEffect, useRef } from 'react';
import { Spinner } from './Loader.jsx';

export default function ConfirmDialog({ title, children, busy, onCancel, onConfirm }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className="festival-dialog" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 className="dialog-title">{title}</h2><div>{children}</div>
    <div className="control-actions"><button className="button secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className={`button primary ${busy ? 'is-busy' : ''}`} disabled={busy} onClick={onConfirm}>{busy ? <><Spinner size={14} />Please wait…</> : 'Continue'}</button></div>
  </dialog>;
}
