// Keep only the My Memories contract. Never accept storage URLs or review fields.
export function parseMyMemories(data) {
  const quota = data?.quota;
  if (!Array.isArray(data?.photos) || !quota || !Number.isSafeInteger(quota.limit) || quota.limit < 1
    || !Number.isSafeInteger(quota.acceptedCount) || quota.acceptedCount < 0
    || !Number.isSafeInteger(quota.remainingSlots) || quota.remainingSlots < 0 || quota.remainingSlots > quota.limit) {
    throw new Error('Invalid My Memories response');
  }
  const photos = data.photos.map(photo => {
    if (!/^[a-f0-9]{24}$/i.test(photo?.id) || !['PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED', 'DELETED'].includes(photo.status)
      || typeof photo.createdAt !== 'string' || !Number.isFinite(Date.parse(photo.createdAt))) throw new Error('Invalid Memory Photo');
    return { id: photo.id, status: photo.status, createdAt: photo.createdAt };
  });
  if (new Set(photos.map(photo => photo.id)).size !== photos.length) throw new Error('Duplicate Memory Photo');
  return { photos, quota: { limit: quota.limit, acceptedCount: quota.acceptedCount, remainingSlots: quota.remainingSlots } };
}
