import test from 'node:test';
import assert from 'node:assert/strict';
import { readLanguage, translate, formatFestivalDate } from '../src/i18n/locale.js';
import { messages } from '../src/i18n/messages.js';

test('Burmese is the default; English preference survives and inaccessible storage is safe', () => {
  assert.equal(readLanguage({ getItem: () => null }), 'my');
  assert.equal(readLanguage({ getItem: () => 'en' }), 'en');
  assert.equal(readLanguage({ getItem: () => 'unsupported' }), 'my');
  assert.equal(readLanguage({ getItem: () => { throw Error('blocked'); } }), 'my');
});

test('public copy works in both languages, including concise Burmese Home copy', () => {
  for (const key of ['Sign in', 'Privacy Policy', 'All Memories', 'Release a wish', 'Results']) {
    assert.notEqual(translate(key, 'my'), key);
    assert.equal(translate(key, 'en'), key);
  }
  const home = 'ဆီမီးရောင်စုံ';
  assert.equal(translate(home, 'my'), home);
  assert.equal(translate('Let the lanterns glow,', 'my'), home);
  assert.equal(translate('Let the lanterns glow,', 'en'), 'Let the lanterns glow,');
});

test('dynamic counts and labels preserve values; unknown content and React nodes pass through', () => {
  assert.equal(translate('Resend in 43s'), '43s နေရင် ပြန်ပို့မယ်');
  assert.equal(translate('Show photo 2 of 3'), 'ဓာတ်ပုံ 3 ပုံထဲက ပုံ 2 ကို ပြမယ်');
  assert.equal(translate('Meet Aung'), 'မိတ်ဆက် · Aung');
  assert.equal(translate('Unarchive this memory?'), messages['Unarchive this memory?']);
  assert.equal(translate('A visitor’s own message'), 'A visitor’s own message');
  assert.equal(translate('  Sign in '), `  ${messages['Sign in']} `);
  assert.equal(translate(3), 3);
  const node = { type: 'strong', props: { children: 'name' } };
  assert.equal(translate(node), node);
});

test('dates use the selected language and Myanmar time zone', () => {
  const date = '2026-10-27T20:00:00Z';
  assert.equal(formatFestivalDate(date, 'en'), '28 October 2026');
  assert.equal(formatFestivalDate(date, 'my'), '၂၈ အောက် ၂၀၂၆');
});
