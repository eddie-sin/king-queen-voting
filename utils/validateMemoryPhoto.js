const sharp = require("sharp");
const AppError = require("./appError");

const types = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

module.exports = async (file) => {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length
    || file.buffer.length > 5 * 1024 * 1024) {
    throw new AppError("Upload one non-empty JPG, PNG or WebP image of at most 5 MB.", 400);
  }
  try {
    const image = sharp(file.buffer, { failOn: "warning", limitInputPixels: 25000000 });
    const metadata = await image.metadata();
    if (!Object.hasOwn(types, metadata.format) || types[metadata.format] !== file.mimetype
      || (metadata.pages || 1) !== 1) throw new Error("Unsupported image");
    // Decode and re-encode, rejecting damaged pixels and stripping metadata and
    // appended content. Metadata inspection alone does not validate pixel data.
    const buffer = await image.rotate().toFormat(metadata.format).toBuffer();
    if (buffer.length > 5 * 1024 * 1024) throw new Error("Encoded image too large");
    return { ...file, buffer, size: buffer.length, mimetype: types[metadata.format] };
  } catch {
    throw new AppError("Image content must be a valid, matching JPG, PNG or WebP (single frame, at most 25 million pixels).", 400);
  }
};
