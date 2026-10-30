const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const AppError = require("./appError");
const s3 = require("./s3");

const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const FOLDER = /^(candidates|gallery\/(memory|entertainment|lantern|about))$/;
// One plain file name with an optional extension: no slashes, no "..", no hidden files.
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9]+)?$/;
exports.localUploadDirectory = path.resolve(process.env.LOCAL_UPLOAD_DIR || path.join(__dirname, "..", "uploads"));

exports.uploadImage = async (file, folder) => {
  if (!FOLDER.test(folder)) {
    throw new AppError("Invalid image storage folder.", 400);
  }
  if (!extensions[file.mimetype] || !Buffer.isBuffer(file.buffer)) {
    throw new AppError("Only JPG, PNG or WebP images are allowed.", 400);
  }
  file = await require("./validateMemoryPhoto")(file);
  if (process.env.NODE_ENV === "production") return s3.uploadImage(file, folder);

  const filename = `${crypto.randomUUID()}.${extensions[file.mimetype]}`;
  const directory = path.join(exports.localUploadDirectory, folder);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, filename), file.buffer, { flag: "wx" });
  return `/uploads/${folder}/${filename}`;
};

// Works out where an image this app stored lives. Same rule as uploads:
// production uses S3, everything else uses the local uploads directory.
// Any other URL (outside links, other folders, path tricks) returns null.
const locate = (url, folder) => {
  if (typeof url !== "string" || !FOLDER.test(folder)) return null;
  if (process.env.NODE_ENV === "production") {
    const key = s3.keyFromUrl(url);
    if (!key || !key.startsWith(`${folder}/`) || !FILE_NAME.test(key.slice(folder.length + 1))) return null;
    return { key };
  }
  const prefix = `/uploads/${folder}/`;
  if (!url.startsWith(prefix) || !FILE_NAME.test(url.slice(prefix.length))) return null;
  const file = path.join(exports.localUploadDirectory, folder, url.slice(prefix.length));
  if (!file.startsWith(exports.localUploadDirectory + path.sep)) return null;
  return { file };
};

exports.isOwnedImage = (url, folder) => Boolean(locate(url, folder));

// Permanently deletes an image this app stored. Returns false (and does nothing)
// for URLs the app does not own. Errors such as missing S3 permission are thrown.
exports.deleteImage = async (url, folder) => {
  const location = locate(url, folder);
  if (!location) return false;
  if (location.key) await s3.deleteImage(location.key);
  else await fs.rm(location.file, { force: true });
  return true;
};
