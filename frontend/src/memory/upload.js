export function uploadSelectionError(file, count, remainingSlots) {
  if (!Number.isInteger(remainingSlots) || remainingSlots < 1 || count >= Math.min(3, remainingSlots)) return 'Choose only as many photos as your remaining lifetime slots.';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file?.type)) return 'Choose a JPG, PNG or WebP photo.';
  if (!file.size || file.size > 5 * 1024 * 1024) return 'Each photo must be non-empty and no larger than 5 MB.';
  return '';
}
export function parseUploadedMemory(photo) {
  if (!/^[a-f0-9]{24}$/i.test(photo?.id) || photo.status !== 'PENDING' || typeof photo.createdAt !== 'string' || !Number.isFinite(Date.parse(photo.createdAt))) throw Error('Invalid confirmation');
  return { id: photo.id, status: 'PENDING', createdAt: photo.createdAt };
}
