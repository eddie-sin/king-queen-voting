const crypto = require("node:crypto");
const sharp = require("sharp");

class MemoryPhotoImageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MemoryPhotoImageError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new MemoryPhotoImageError(code, message); };
const heicSignature = (buffer) => buffer.length >= 12
  && buffer.subarray(4, 8).toString("ascii") === "ftyp"
  && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(buffer.subarray(8, 12).toString("ascii"));
const animatedPng = (buffer) => {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return false;
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    if (length > buffer.length - offset - 12) return false;
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "acTL") return true;
    if (type === "IEND") return false;
    offset += length + 12;
  }
  return false;
};

exports.normalizeMemoryPhoto = async (file, options = {}) => {
  const limits = {
    maxInputBytes: 5 * 1024 * 1024,
    maxOutputBytes: 5 * 1024 * 1024,
    maxPixels: 16_000_000,
    maxWidth: 8192,
    maxHeight: 8192,
    ...options,
  };
  if (!Buffer.isBuffer(file?.buffer)) fail("MEMORY_PHOTO_INVALID_IMAGE", "Please choose a valid image file.");
  if (file.buffer.length > limits.maxInputBytes) fail("MEMORY_PHOTO_IMAGE_TOO_LARGE", "The image must be 5 MiB or smaller.");
  if (heicSignature(file.buffer) || /hei[cf]/i.test(file.mimetype || "")) {
    fail("MEMORY_PHOTO_UNSUPPORTED_HEIC", "HEIC images are not supported yet. Please choose a JPEG, PNG, or WebP image.");
  }
  if (animatedPng(file.buffer)) fail("MEMORY_PHOTO_ANIMATED_NOT_ALLOWED", "Animated or multi-page images are not supported.");
  let metadata;
  try {
    metadata = await sharp(file.buffer, { failOn: "error", animated: true, limitInputPixels: limits.maxPixels }).metadata();
  } catch (error) {
    if (/pixel limit/i.test(error.message)) fail("MEMORY_PHOTO_DIMENSIONS_TOO_LARGE", "The image dimensions are too large.");
    fail("MEMORY_PHOTO_INVALID_IMAGE", "The image is corrupt or invalid.");
  }
  if (!["jpeg", "png", "webp"].includes(metadata.format)) fail("MEMORY_PHOTO_UNSUPPORTED_FORMAT", "Only JPEG, PNG, and WebP images are supported.");
  if ((metadata.pages || 1) !== 1) fail("MEMORY_PHOTO_ANIMATED_NOT_ALLOWED", "Animated or multi-page images are not supported.");
  if (!metadata.width || !metadata.height || metadata.width > limits.maxWidth || metadata.height > limits.maxHeight
    || metadata.width * metadata.height > limits.maxPixels) {
    fail("MEMORY_PHOTO_DIMENSIONS_TOO_LARGE", "The image dimensions are too large.");
  }
  let buffer;
  try {
    buffer = await sharp(file.buffer, { failOn: "error", limitInputPixels: limits.maxPixels })
      .rotate()
      .webp({ quality: 82, effort: 4, smartSubsample: true })
      .toBuffer();
  } catch {
    fail("MEMORY_PHOTO_INVALID_IMAGE", "The image could not be processed.");
  }
  if (buffer.length > limits.maxOutputBytes) fail("MEMORY_PHOTO_OUTPUT_TOO_LARGE", "The processed image is too large.");
  const output = await sharp(buffer).metadata();
  if (output.format !== "webp" || !output.width || !output.height || output.width > limits.maxWidth
    || output.height > limits.maxHeight || output.width * output.height > limits.maxPixels) {
    fail("MEMORY_PHOTO_DIMENSIONS_TOO_LARGE", "The image dimensions are too large.");
  }
  return {
    buffer,
    contentType: "image/webp",
    extension: "webp",
    byteLength: buffer.length,
    width: output.width,
    height: output.height,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
};

exports.MemoryPhotoImageError = MemoryPhotoImageError;
