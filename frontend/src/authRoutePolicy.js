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
