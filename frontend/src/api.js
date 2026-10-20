import { publicCandidate, publicLantern } from './domain.js';

export class ApiError extends Error {
  constructor(message, { status = 0, interrupted = false } = {}) {
    super(message); this.name = 'ApiError'; this.status = status; this.interrupted = interrupted;
  }
}

export function createApi({ baseUrl = '/api/v1', fetchImpl = (...args) => fetch(...args), timeoutMs = 20000 } = {}) {
  async function request(path, { method = 'GET', body, token, signal } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, timeoutMs);
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetchImpl(baseUrl + path, {
        method, signal: controller.signal, cache: 'no-store', credentials: 'omit',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      let payload;
      try { payload = await response.json(); } catch {
        throw new ApiError('The server returned an unreadable response. Please try refreshing.', { status: response.status, interrupted: method !== 'GET' });
      }
      if (!response.ok || payload.status !== 'success') {
        // Do not expose a key even if a backend error inadvertently echoes one.
        const message = typeof payload.message === 'string' ? payload.message.replace(/[a-f0-9]{64}/gi, '[private key]') : 'The request could not be completed.';
        throw new ApiError(message, { status: response.status, interrupted: response.status >= 500 });
      }
      return payload;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('Connection interrupted. Check your connection and try again.', { interrupted: true });
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
  }
  return {
    async candidates(options) {
      const { data } = await request('/candidates', options);
      if (!Array.isArray(data?.candidates)) throw new ApiError('Candidate data is unavailable.');
      return data.candidates.map(publicCandidate).filter(c => c?._id && c.category && c.isActive);
    },
    async lanterns(options) {
      const { data } = await request('/images?section=lantern', options);
      if (!Array.isArray(data?.images)) throw new ApiError('Lantern gallery data is unavailable.');
      return data.images.map(publicLantern).filter(Boolean);
    },
    async settings(options) { return (await request('/settings', options)).data?.schedule ?? null; },
    async register(email, password) { return (await request('/auth/register', { method: 'POST', body: { email, password } })).data; },
    async login(email, password) { return (await request('/auth/login', { method: 'POST', body: { email, password } })).data; },
    async me(token) { return (await request('/auth/me', { token })).data?.user; },
    async myVotes(token, votingKey) { return (await request('/voting/my-votes', { method: 'POST', token, body: { votingKey } })).data?.votes; },
    async submit(token, votingKey, candidateId, contest) { return request('/voting/submit', { method: 'POST', token, body: { votingKey, candidateId, contest } }); },
    async change(token, votingKey, candidateId, contest) { return request('/voting/change', { method: 'PATCH', token, body: { votingKey, candidateId, contest } }); },
    async remove(token, votingKey, contest) { return request('/voting/remove', { method: 'DELETE', token, body: { votingKey, contest } }); },
  };
}
