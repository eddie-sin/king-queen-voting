export const MEMORY_ASSETS = '/memory-photo/';
export const MEMORY_TABS = [
  { id: 'all', hash: '#memory-gallery', label: 'All Memories' },
  { id: 'mine', hash: '#my-memories', label: 'My Memories' },
  { id: 'upload', hash: '#memory-upload', label: 'Upload' },
];

export function memoryTabFromHash(hash = '') {
  return MEMORY_TABS.find(tab => tab.hash === hash)?.id || (hash === '#memory' ? 'all' : null);
}
