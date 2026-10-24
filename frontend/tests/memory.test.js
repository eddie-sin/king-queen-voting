import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DEMO_PHOTOS, MEMORY_TABS, memoryTabFromHash, selectionError } from '../src/memory/demo.js';

test('Memory routes use existing hash navigation without claiming festival routes', () => {
  for (const tab of MEMORY_TABS) assert.equal(memoryTabFromHash(tab.hash), tab.id);
  assert.equal(memoryTabFromHash('#memory'), 'all');
  assert.equal(memoryTabFromHash('#my-memories-demo'), 'mine');
  for (const hash of ['#home', '#wishes', '#account', '#queen', '']) assert.equal(memoryTabFromHash(hash), null);
});

test('demo photographs resolve to original local assets and have accessible descriptions', () => {
  for (const photo of DEMO_PHOTOS) {
    assert(existsSync(new URL(`../public/memory-photo/${photo.image}`, import.meta.url)));
    assert(photo.alt.length > 20);
  }
});

test('preview selection accepts supported files and enforces three slots and the live size limit', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(selectionError({ type, size: 5 * 1024 * 1024 }, 2), '');
  for (const file of [{ type: 'image/gif', size: 10 }, { type: 'text/html', size: 10 }, { type: 'image/png', size: 0 }, { type: 'image/png', size: 5 * 1024 * 1024 + 1 }]) assert(selectionError(file, 0));
  assert(selectionError({ type: 'image/png', size: 20 }, 3));
});

test('Memory footer retains its intended separator without malformed encoding', () => {
  const source = readFileSync(new URL('../src/memory/MemoryPhotoDemo.jsx', import.meta.url), 'utf8');
  assert(!source.includes('\ufffd'));
  assert(source.includes('Approved festival memories · Original design & artwork preserved'));
});
