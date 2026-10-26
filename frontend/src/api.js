import { authConfig, csrfHeaders } from './authSession.js';
import { parseLikeStates, parseLikeMutation } from './memory/likes.js';
import { uploadSelectionError, parseUploadedMemory } from './memory/upload.js';
import { parseMemoryGallery } from './memory/gallery.js';
import { publicCandidate, publicResults, publicLantern } from './domain.js';
import { parseMyMemories } from './memory/mine.js';

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
    const multipart = body instanceof FormData;
    try {
      const response = await fetchImpl(baseUrl + path, {
        method, signal: controller.signal, cache: 'no-store', credentials: 'same-origin',
        headers: { Accept: 'application/json', ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}), ...(!['GET','HEAD'].includes(method) ? await csrfHeaders(fetchImpl,baseUrl) : {}) },
        ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
      });
      let payload;
      try { payload = await response.json(); } catch {
        throw new ApiError('The server returned an unreadable response. Please try refreshing.', { status: response.status, interrupted: method !== 'GET' });
      }
      if (!response.ok || payload.status !== 'success') {
        // Keep accidental long secret-like strings out of error messages.
        const message = typeof payload.message === 'string' ? payload.message.replace(/[a-f0-9]{64}/gi, '[redacted]') : 'The request could not be completed.';
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
    authConfig: () => authConfig(fetchImpl,baseUrl),
    async authAction(path, body) { return (await request('/auth'+path,{method:'POST',body})).data; },
    async pendingAuth() { return (await request('/auth/pending')).data; },
    async logout() { return request('/auth/logout',{method:'POST',body:{}}); },
    async lanternStatus() { return (await request('/lantern-voting')).data; },
    async myLanternVote(token) { return (await request('/lantern-voting/mine', {token})).data; },
    async voteLantern(token, lanternId, window) { return request('/lantern-voting', {method:'POST',token,body:{lanternId,window}}); },
    async memoryPhotoLikeStates(token, photoIds, options = {}) {
      if (!token) throw new ApiError('Please sign in first.', { status: 401 });
      if (!Array.isArray(photoIds) || photoIds.length < 1 || photoIds.length > 50 || photoIds.some(id => !/^[a-f0-9]{24}$/i.test(id)) || new Set(photoIds.map(id => id.toLowerCase())).size !== photoIds.length) throw new ApiError('Invalid photo IDs.');
      const payload = await request(`/memory-photos/like-status?photoIds=${photoIds.join(',')}`, { token, signal: options.signal });
      try { return parseLikeStates(payload, photoIds); } catch { throw new ApiError('Heart states are unavailable.'); }
    },
    async setMemoryPhotoLike(token, id, liked, options = {}) {
      if (!token) throw new ApiError('Please sign in first.', { status: 401 });
      if (!/^[a-f0-9]{24}$/i.test(id) || typeof liked !== 'boolean') throw new ApiError('Invalid like request.');
      const payload = await request(`/memory-photos/${id}/like`, { method: liked ? 'POST' : 'DELETE', token, signal: options.signal });
      try { return parseLikeMutation(payload.data, id); } catch { throw new ApiError('Like confirmation is incomplete.', { interrupted: true }); }
    },
    async uploadMemoryPhoto(token, file, options = {}) {
      if (!token) throw new ApiError('Please sign in first.', { status: 401 });
      const invalid = uploadSelectionError(file, 0, 1);
      if (invalid) throw new ApiError(invalid, { status: 400 });
      const body = new FormData(); body.append('images', file);
      const payload = await request('/memory-photos', { method: 'POST', token, body, signal: options.signal });
      try { return parseUploadedMemory(payload.data?.photo); }
      catch { throw new ApiError('Submission confirmation is incomplete. Check My Memories before trying again.', { interrupted: true }); }
    },
    async memoryPhotos(page = 1, options = {}) {
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new ApiError('Invalid gallery page.');
      const payload = await request(`/memory-photos?page=${page}&limit=20`, { signal: options.signal });
      try { return parseMemoryGallery(payload, page); }
      catch { throw new ApiError('The gallery returned incomplete information. Please try again.'); }
    },
    async myMemoryPhotos(token, options = {}) {
      const { data } = await request('/memory-photos/mine', { ...options, token });
      try { return parseMyMemories(data); }
      catch { throw new ApiError('Your memories returned incomplete information. Please try again.'); }
    },
    memoryPhotoImageUrl(id) {
      if (!/^[a-f0-9]{24}$/i.test(id)) throw new ApiError('Invalid Memory Photo ID.');
      return `${baseUrl}/memory-photos/${id}/image`;
    },
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
    async settings(options) { return (await request('/settings', options)).data?.controls ?? null; },
    async results(options) { return publicResults((await request('/results', options)).data?.results); },
    async register(email, password, operationId = crypto.randomUUID()) { return (await request('/auth/register', { method: 'POST', body: { email, password, operationId } })).data; },
    async login(email, password) { return (await request('/auth/login', { method: 'POST', body: { email, password } })).data; },
    async me(token) { return (await request('/auth/me', { token })).data?.user; },
    async session() { return (await request('/auth/me')).data; },
    async myVotes(token) { return (await request('/voting/my-votes', { token })).data; },
    async submit(token, candidateId, contest, controls) { return request('/voting/submit', { method: 'POST', token, body: { candidateId, contest, round: controls.round, window: controls.window } }); },
  };
}
