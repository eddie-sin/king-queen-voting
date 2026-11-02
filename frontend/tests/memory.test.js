import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MEMORY_TABS, memoryTabFromHash } from '../src/memory/config.js';
import { uploadSelectionError as selectionError } from '../src/memory/upload.js';

test('Memory routes use existing hash navigation without claiming festival routes', () => {
  for (const tab of MEMORY_TABS) assert.equal(memoryTabFromHash(tab.hash), tab.id);
  assert.equal(memoryTabFromHash('#memory'), 'all');
  assert.equal(memoryTabFromHash('#my-memories-demo'), null);
  for (const hash of ['#home', '#wishes', '#account', '#queen', '']) assert.equal(memoryTabFromHash(hash), null);
});

test('preview selection accepts supported files and enforces three slots and the live size limit', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(selectionError({ type, size: 5 * 1024 * 1024 }, 2, 3), '');
  for (const file of [{ type: 'image/gif', size: 10 }, { type: 'text/html', size: 10 }, { type: 'image/png', size: 0 }, { type: 'image/png', size: 5 * 1024 * 1024 + 1 }]) assert(selectionError(file, 0, 3));
  assert(selectionError({ type: 'image/png', size: 20 }, 3, 3));
});

test('Memory footer retains its intended separator without malformed encoding', () => {
  const source = readFileSync(new URL('../src/memory/MemoryPhoto.jsx', import.meta.url), 'utf8');
  assert(!source.includes('\ufffd'));
  assert(source.includes('Connected Memory Photo'));
});
