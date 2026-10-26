// The backend's public list contains message-only records and an opaque cursor.
// The authenticated allowance is scoped to the account in the Bearer token.
export const wishBackendConfig = {
  listRequest({ cursor, limit }) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return { path: `/wishes?${params}` };
  },
  mapList: payload => ({ wishes: payload.data.wishes, nextCursor: payload.data.nextCursor, total: payload.data.total }),
  allowanceRequest: () => ({ path: '/wishes/mine' }),
  mapAllowance: payload => ({ used: payload.data.used }),
  createRequest: message => ({ path: '/wishes', method: 'POST', body: { message } }),
  mapCreated: payload => ({ wish: payload.data.wish }),
};
