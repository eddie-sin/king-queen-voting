const segmenter = new Intl.Segmenter('my',{granularity:'grapheme'});
exports.length = text => Array.from(segmenter.segment(text)).length;
exports.valid = text => typeof text === 'string' && Boolean(text.trim()) &&
  exports.length(text.trim()) <= 280 && Buffer.byteLength(text,'utf8') <= 8192 && text.split('\n').length <= 8 &&
  !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text);
exports.message = 'Keep your wish within 280 characters, 8 lines and 8 KB.';
