import test from 'node:test';
import assert from 'node:assert/strict';
import { lanternFormData, lanternMetadata } from '../src/lanterns.js';

test('lantern metadata trims fields and enforces the UI contract', () => {
  assert.deepEqual(lanternMetadata({ title: '  Golden lantern ', description: '  Bamboo frame. ' }), { title: 'Golden lantern', description: 'Bamboo frame.' });
  assert.throws(() => lanternMetadata({ title: '   ', description: '' }), /title is required/i);
  assert.throws(() => lanternMetadata({ title: 'x'.repeat(121), description: '' }), /120/);
  assert.throws(() => lanternMetadata({ title: 'Valid', description: 'x'.repeat(1001) }), /1000/);
});

test('new lantern form data binds one file to its own title and description', () => {
  const file = new File(['image'], 'lantern.png', { type: 'image/png' });
  const data = lanternFormData({ title: ' First ', description: ' First details ' }, [file]);
  assert.equal(data.get('section'), 'lantern');
  assert.equal(data.get('title'), 'First');
  assert.equal(data.get('description'), 'First details');
  assert.equal(data.getAll('images').length, 1);
  assert.throws(() => lanternFormData({ title: 'Second', description: '' }, []), /one image/i);
  assert.throws(() => lanternFormData({ title: 'Second', description: '' }, [file, file]), /one image/i);
});
