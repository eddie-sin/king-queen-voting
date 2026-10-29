import { messages } from './messages.js';

export const LANGUAGE_KEY = 'festival-language';
export function readLanguage(storage) {
  try { return (storage ?? globalThis.localStorage)?.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'my'; }
  catch { return 'my'; }
}

const normalize = text => text.trim().replace(/\s+/g, ' ');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(messages).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => ({
  regex: new RegExp('^' + key.split(/\{\d+\}/).map(escape).join('(.+?)') + '$'), value,
}));

export function translate(text, language = 'my', values) {
  if (typeof text !== 'string' || !text.trim()) return text;
  const key = normalize(text);
  if (language === 'en') return values ? text.replace(/\{(\d+)\}/g, (_, index) => values[index] ?? `{${index}}`) : text;
  let result = messages[key];
  if (language === 'my' && result === undefined) {
    for (const pattern of patterns) {
      const match = key.match(pattern.regex);
      if (match) {
        result = pattern.value.replace(/\{(\d+)\}/g, (_, index) => match[Number(index) + 1]);
        break;
      }
    }
    if (result === undefined && key.includes(' · ')) result = key.split(' · ').map(part => translate(part, language)).join(' · ');
  }
  if (result === undefined) return text;
  if (values) result = result.replace(/\{(\d+)\}/g, (_, index) => values[index] ?? `{${index}}`);
  return (text.match(/^\s*/)?.[0] || '') + result + (text.match(/\s*$/)?.[0] || '');
}

export function formatFestivalDate(value, language) {
  const date = new Date(value);
  if (language === 'my') {
    // Some browsers fall back to English for my-MM. Keep card dates compact and
    // consistent with the English date, regardless of installed locale data.
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Asia/Yangon',
    }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const months = ['ဇန်', 'ဖေ', 'မတ်', 'ဧ', 'မေ', 'ဇွန်', 'ဇူ', 'ဩ', 'စက်', 'အောက်', 'နို', 'ဒီ'];
    return `${parts.day} ${months[Number(parts.month) - 1]} ${parts.year}`.replace(/\d/g, digit => '၀၁၂၃၄၅၆၇၈၉'[Number(digit)]);
  }
  return date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Yangon',
  });
}
