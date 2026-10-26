// Keep the JWT only in application memory. A page refresh requires signing in again.
const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
export function imageSrc(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}
export async function request(path, { token, method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${base}/api/v1${path}`, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal, credentials: 'omit' });
  } catch (error) { throw new Error(error?.name === 'AbortError' ? 'Request canceled.' : 'Unable to reach the voting API. Check that the backend is running and your API URL is correct.'); }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || `Request failed (HTTP ${res.status}).`), { status: res.status });
  return json.data ?? json;
}

export async function privateImage(path, { token, signal }) {
  const response = await fetch(`${base}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` }, signal, cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error('Private photo is unavailable. Refresh or sign in again.');
  const blob = await response.blob();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('Invalid photo response.');
  return blob;
}
