import test from 'node:test';
import assert from 'node:assert/strict';
import { waistNumberFor, candidateInGallery } from '../src/waistNumbers.js';

test('each live Queen and King pair shares its waist number', () => {
  const pairs = [
    ['Pann Myat Nadi', 'Zwe Wai Yan Htet'],
    ['Pan Hsu Han', 'Than Htut Oo'],
    ['Thiri San', 'Ar Kar Min'],
    ['Ei Thwel Shin Thant', 'Alex Lian'],
    ['Su Yati Linn', 'Nyein Chan San'],
    ['Hay Mann Oo', 'Aung Kaung San'],
    ['Hnin Thiri', 'Wera'],
  ];
  pairs.forEach(([queen, king], index) => {
    assert.equal(waistNumberFor({ fullName: queen }), index + 1);
    assert.equal(waistNumberFor({ fullName: king }), index + 1);
  });
});

test('Aung Khant Paing is absent from the King gallery', () => {
  assert.equal(candidateInGallery({ fullName: 'Aung Khant Paing', category: 'king' }, 'king'), false);
  assert.equal(candidateInGallery({ fullName: 'Wera', category: 'king' }, 'king'), true);
  assert.equal(candidateInGallery({ fullName: 'Hnin Thiri', category: 'queen' }, 'queen'), true);
});
