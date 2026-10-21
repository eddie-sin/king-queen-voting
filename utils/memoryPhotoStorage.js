const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const AppError = require("./appError");
const { localUploadDirectory } = require("./imageStorage");
const s3 = require("./s3");

const types = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const extensions = Object.fromEntries(Object.entries(types).map(([extension, type]) => [type, extension]));
const privateDirectory = path.resolve(process.env.MEMORY_PHOTO_UPLOAD_DIR
  || path.join(path.dirname(localUploadDirectory), "private-memory-photos"));
const inside = (parent, target) => {
  const relative = path.relative(parent, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};

const validateKey = (key) => {
  if (typeof key !== "string" || !/^memory-photos\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(key)) {
    throw new AppError("Invalid Memory Photo image key.", 400);
  }
};

const localPath = async (key) => {
  // Check both configured paths and resolved paths to catch directory symlinks.
  if (inside(localUploadDirectory, privateDirectory)) {
    throw new AppError("Private image storage must be outside public uploads.", 503);
  }
  await fs.mkdir(path.join(privateDirectory, "memory-photos"), { recursive: true });
  const root = await fs.realpath(privateDirectory);
  const directory = await fs.realpath(path.join(privateDirectory, "memory-photos"));
  let publicRoot = localUploadDirectory;
  try { publicRoot = await fs.realpath(localUploadDirectory); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!inside(root, directory) || inside(publicRoot, directory)) {
    throw new AppError("Private image storage must be outside public uploads.", 503);
  }
  const target = path.join(directory, path.basename(key));
  try {
    if (!(await fs.lstat(target)).isFile()) throw new AppError("Invalid private image file.", 400);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return target;
};

exports.uploadImage = async (file) => {
  if (!file || !Object.hasOwn(extensions, file.mimetype) || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    throw new AppError("Only non-empty JPG, PNG or WebP images are allowed.", 400);
  }
  if (file.buffer.length > 5 * 1024 * 1024) throw new AppError("Memory Photo images must not exceed 5 MB.", 400);
  const key = `memory-photos/${crypto.randomUUID()}.${extensions[file.mimetype]}`;
  if (process.env.NODE_ENV === "production") await s3.uploadPrivateMemoryPhoto(file, key);
  else await fs.writeFile(await localPath(key), file.buffer, { flag: "wx", mode: 0o600 });
  return key;
};

// Internal server helper. Controllers must enforce admin moderation permission
// or enabled/APPROVED public access before streaming these bytes; no URL is issued.
exports.getImage = async (key) => {
  validateKey(key);
  if (process.env.NODE_ENV === "production") return s3.getPrivateMemoryPhoto(key);
  try {
    const body = await fs.readFile(await localPath(key));
    return { body, contentType: types[path.extname(key).slice(1)], contentLength: body.length };
  } catch (error) {
    if (error.code === "ENOENT") throw new AppError("Memory Photo image not found.", 404);
    throw error;
  }
};

// Idempotent for absent objects; never accepts public-gallery keys or paths.
exports.deleteImage = async (key) => {
  validateKey(key);
  if (process.env.NODE_ENV === "production") return s3.deletePrivateMemoryPhoto(key);
  try { await fs.unlink(await localPath(key)); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};
