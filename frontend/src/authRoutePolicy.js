const DEMO_MEMORY_HASHES = new Set(['#my-memories-demo', '#memory-gallery-demo', '#memory-upload-demo']);

export function isMemoryDemoHash(hash = '') {
  return DEMO_MEMORY_HASHES.has(String(hash).toLowerCase());
}

export function shouldShowGuestLanding({ sessionReady, session, fixtureMode = false } = {}) {
  return !fixtureMode && Boolean(sessionReady) && !session;
}

export function shouldShowSessionLoader({ sessionReady, session, fixtureMode = false } = {}) {
  return !fixtureMode && !sessionReady && !session;
}

export function shouldShowSessionCheckShell({ sessionReady, session, fixtureMode = false } = {}) {
  return !fixtureMode && !sessionReady && Boolean(session);
}

export function resumeAfterLogin({ returnTo, hasSession } = {}) {
  if (!hasSession) return null;
  const target = typeof returnTo === 'string' && returnTo.startsWith('#') ? returnTo : '#home';
  return target || '#home';
}
