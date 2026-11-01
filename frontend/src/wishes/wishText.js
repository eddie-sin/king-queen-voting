const segmenter = new Intl.Segmenter('my',{granularity:'grapheme'});
export const wishLength = text => Array.from(segmenter.segment(text)).length;
export const validWishText = text => typeof text==='string' && Boolean(text.trim()) && wishLength(text.trim())<=280 && new TextEncoder().encode(text).length<=8192 && text.split('\n').length<=8 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text);
