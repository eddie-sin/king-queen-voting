// This marker identifies UI state only. Authentication is exclusively an HttpOnly cookie.
let current = null;
const legacy = "thadingyut_voter_session";
export function readStoredSession() {
  return current;
}
export function writeStoredSession(value) {
  const changed = current?.token !== value?.token;
  current = value;
  try {
    localStorage.removeItem(legacy);
  } catch {}
  if (changed && typeof window !== "undefined")
    window.dispatchEvent(new Event("festival-session-change"));
}
export function announceAccountChange() {
  try {
    localStorage.setItem("festival-account-change", String(Date.now()));
  } catch {}
}
let configPromise;
let refreshAt = 0;
export function clearAuthConfig() {
  configPromise = null;
  refreshAt = 0;
}
export async function authConfig(
  fetchImpl = (...args) => fetch(...args),
  base = "/api/v1",
) {
  if (configPromise && Date.now() >= refreshAt) clearAuthConfig();
  if (!configPromise) {
    refreshAt = Infinity;
    configPromise = fetchImpl(base + "/auth/config", {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json" },
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok || !body.data?.csrfToken)
          throw new Error(
            "Account service is unavailable. Refresh and try again.",
          );
        refreshAt = Date.now() + Math.min(60000, Math.max(1000, Number(body.data.refreshAfter) || 60000));
        return body.data;
      })
      .catch((e) => {
        configPromise = null;
        throw e;
      });
  }
  return configPromise;
}
export async function csrfHeaders(fetchImpl, base) {
  return { "X-CSRF-Token": (await authConfig(fetchImpl, base)).csrfToken };
}
