// The backend's public list contains wish content, reaction counts and an opaque cursor.
// The authenticated allowance is scoped to the account in the Bearer token.
export const wishBackendConfig = {
  listRequest({ cursor, limit }) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return { path: `/wishes?${params}` };
  },
  mapList: payload => ({ wishes: payload.data.wishes, nextCursor: payload.data.nextCursor, total: payload.data.total }),
  allowanceRequest: () => ({ path: '/wishes/mine' }),
  mapAllowance: payload => ({ used: payload.data.used, isOpen: payload.data.isOpen }),
  myWishesRequest: () => ({ path: '/wishes/mine/wishes', mine: true }),
  mapMyWishes: payload => payload.data.wishes,
  createRequest: (message, name) => ({ path: '/wishes', method: 'POST', body: { message, ...(name ? { name } : {}) } }),
  mapCreated: payload => ({ wish: payload.data.wish }),
  mapReaction: payload => ({ reactions: payload.data.reactions, reacted: payload.data.reacted }),
};
