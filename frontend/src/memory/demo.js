export const MEMORY_ASSETS = '/memory-photo/';
export const MEMORY_TABS = [
  { id: 'all', hash: '#memory-gallery', label: 'All Memories' },
  { id: 'mine', hash: '#my-memories', label: 'My Memories' },
  { id: 'upload', hash: '#memory-upload', label: 'Upload' },
];
export function memoryTabFromHash(hash) {
  if (hash === '#memory-upload-demo') return 'upload';
  if (hash === '#memory-gallery-demo') return 'all';
  if (hash === '#my-memories-demo') return 'mine';
  return MEMORY_TABS.find(tab => tab.hash === hash)?.id || (hash === '#memory' ? 'all' : null);
}
export const DEMO_PHOTOS = [
  { id: 'demo-1', image: 'campus-lanterns.png', alt: 'Illustrative students making paper lanterns in a college courtyard', date: '28 OCTOBER 2026', likes: 24 },
  { id: 'demo-2', image: 'campus-together.png', alt: 'Illustrative classmates enjoying a college cultural performance', date: '28 OCTOBER 2026', likes: 18 },
  { id: 'demo-3', image: 'college-thadingyut-memory.png', alt: 'College students holding candles during a Thadingyut celebration', date: '28 OCTOBER 2026', likes: 32 },
];
export function selectionError(file, count) {
  if (count >= 3) return 'Choose up to three photos for this preview.';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return 'Choose a JPG, PNG or WebP photo.';
  if (!file.size || file.size > 5 * 1024 * 1024) return 'Each photo must be non-empty and no larger than 5 MB.';
  return '';
}
