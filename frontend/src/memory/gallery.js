export function parseMemoryGallery(payload, requestedPage) {
  const photos = payload?.data?.photos;
  const pagination = payload?.pagination;
  if (!Array.isArray(photos) || !pagination || pagination.page !== requestedPage || pagination.limit !== 20
    || typeof pagination.hasMore !== 'boolean' || photos.length > 20 || payload.results !== photos.length
    || (pagination.hasMore && (photos.length !== 20 || requestedPage === 1000))) throw new Error('Invalid gallery');
  const ids = new Set();
  return { pagination: { page: pagination.page, limit: 20, hasMore: pagination.hasMore }, photos: photos.map(photo => {
    if (!/^[a-f0-9]{24}$/i.test(photo?.id) || ids.has(photo.id.toLowerCase())
      || typeof photo.createdAt !== 'string' || !Number.isFinite(Date.parse(photo.createdAt))
      || !Number.isSafeInteger(photo.likeCount) || photo.likeCount < 0
      || (photo.status !== undefined && photo.status !== 'APPROVED')) throw new Error('Invalid photo');
    ids.add(photo.id.toLowerCase());
    return { id: photo.id, createdAt: photo.createdAt, likeCount: photo.likeCount };
  }) };
}
