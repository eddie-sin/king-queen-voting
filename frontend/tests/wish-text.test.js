import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {wishLength,validWishText} from '../src/wishes/wishText.js';
const backend=createRequire(import.meta.url)('../../utils/wishText.js');
test('Myanmar combining marks and emoji use the same visible-character limits in browser and API',()=>{
 for(const text of ['မင်္ဂလာပါ '.repeat(20),'🙂'.repeat(280),'🙂'.repeat(281),'a\n'.repeat(9),'a'.repeat(280),'a\u0000']) {
  assert.equal(validWishText(text),backend.valid(text));
 }
 assert.equal(wishLength('👨‍👩‍👧‍👦'),1);
 assert(validWishText('မင်္ဂလာပါ '.repeat(20)));
 assert(validWishText('🙂'.repeat(280)));
 assert(!validWishText('🙂'.repeat(281)));
 assert(!validWishText('a\n'.repeat(9)));
});
