export function parseLikeStates(payload, requestedIds) {
  const photos = payload?.data?.photos;
  const allowed = new Set(requestedIds.map(id => id.toLowerCase())), seen = new Set();
  if (!Array.isArray(photos) || payload.results !== photos.length) throw Error('Invalid states');
  return photos.map(photo => {
    if (typeof photo?.photoId !== 'string' || !allowed.has(photo.photoId.toLowerCase()) || seen.has(photo.photoId.toLowerCase()) || typeof photo.liked !== 'boolean') throw Error('Invalid state');
    seen.add(photo.photoId.toLowerCase()); return { photoId: photo.photoId.toLowerCase(), liked: photo.liked };
  });
}
export function parseLikeMutation(data, id) {
  if (data?.photoId !== id || typeof data.liked !== 'boolean' || !Number.isSafeInteger(data.likeCount) || data.likeCount < 0) throw Error('Invalid mutation');
  return { photoId: id, liked: data.liked, likeCount: data.likeCount };
}
