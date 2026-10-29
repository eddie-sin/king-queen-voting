import './releaseUpdates.css';

// Compare the actual built entry files, not timestamps or API/user data.
export function releaseSignature(doc, base) {
  if (!doc.getElementById('root')) return '';
  const origin = new URL(base).origin;
  const entries = [...doc.querySelectorAll('script[type="module"][src], link[rel="stylesheet"][href]')]
    .map(node => new URL(node.getAttribute('src') || node.getAttribute('href'), base))
    .filter(url => url.origin === origin && /\/assets\//.test(url.pathname))
    .map(url => url.pathname).sort();
  return entries.some(entry => /\.js$/.test(entry)) ? entries.join('|') : '';
}

export function startReleaseUpdates({ automatic = true, interval = 60_000 } = {}) {
  const base = new URL(location.pathname.startsWith('/admin/') ? '/admin/index.html' : '/index.html', location.origin);
  const current = releaseSignature(document, base);
  if (!current) return () => {};
  let pending = '', checking = false, stopped = false, banner, lastActivity = Date.now(), lastSubmit = 0;
  let controller;
  const safeRoutes = new Set(['', 'home', 'privacy', 'developers', 'entertainment', 'results']);
  const canReload = () => automatic && !document.hidden && safeRoutes.has(location.hash.slice(1))
    && Date.now() - lastActivity >= 5_000 && Date.now() - lastSubmit >= 30_000
    && !document.querySelector('dialog[open], [role="dialog"], [aria-busy="true"], input:focus, textarea:focus, select:focus, [contenteditable="true"]:focus');
  const reload = () => {
    // A new document URL also escapes old cached HTML from before this fix.
    const next = new URL(location.href);
    next.searchParams.set('_release', pending);
    location.replace(next.href);
  };
  const showUpdate = () => {
    if (banner) return;
    banner = document.createElement('aside');
    banner.className = 'release-update'; banner.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = 'A website update is ready. Finish what you’re doing, then update.';
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = 'Update now'; button.addEventListener('click', reload);
    banner.append(text, button); document.body.append(banner);
  };
  const apply = () => {
    if (!pending || stopped || document.hidden) return;
    if (canReload()) reload(); else showUpdate();
  };
  const check = async () => {
    if (stopped || checking || document.hidden) return;
    if (pending) { apply(); return; }
    checking = true; controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const url = new URL(base); url.searchParams.set('_check', Date.now());
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return;
      const signature = releaseSignature(new DOMParser().parseFromString(await response.text(), 'text/html'), base);
      if (!stopped && signature && signature !== current) {
        // Short, deterministic identifier. The full signature never contains personal data.
        let hash = 0; for (const char of signature) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
        pending = (hash >>> 0).toString(16); apply();
      }
    } catch { /* Offline or a deployment in progress: keep the current page working. */ }
    finally { clearTimeout(timeout); checking = false; }
  };
  const activity = () => { lastActivity = Date.now(); };
  const submit = () => { lastSubmit = Date.now(); activity(); };
  const events = ['focus', 'pageshow', 'online', 'hashchange'];
  events.forEach(event => window.addEventListener(event, check));
  document.addEventListener('visibilitychange', check);
  document.addEventListener('pointerdown', activity, true);
  document.addEventListener('keydown', activity, true);
  document.addEventListener('submit', submit, true);
  const first = setTimeout(check, 6_000);
  const poll = setInterval(check, interval);
  const idle = setInterval(apply, 2_000);
  return () => {
    stopped = true; controller?.abort(); clearTimeout(first); clearInterval(poll); clearInterval(idle);
    events.forEach(event => window.removeEventListener(event, check));
    document.removeEventListener('visibilitychange', check);
    document.removeEventListener('pointerdown', activity, true);
    document.removeEventListener('keydown', activity, true);
    document.removeEventListener('submit', submit, true);
    banner?.remove();
  };
}
