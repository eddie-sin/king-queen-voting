import { useT } from '../i18n/Language.jsx';
import { useEffect, useId, useRef } from 'react';

export function Dialog({ title, children, onClose, locked = false, className = '' }) {
  const t = useT();
  const ref = useRef(null); const titleId = useId(); const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    ref.current.showModal(); document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = oldOverflow; previous?.focus?.(); };
  }, []);
  return <dialog ref={ref} className={`festival-dialog ${className}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!locked) closeRef.current(); }}>
    {!locked && <button className="close-button" aria-label={t("Close dialog")} onClick={onClose}>×</button>}
    <h2 id={titleId} className="dialog-title">{t(title)}</h2>
    {children}
  </dialog>;
}
