const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const AppError = require("./appError");
const s3 = require("./s3");

const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
exports.localUploadDirectory = path.resolve(process.env.LOCAL_UPLOAD_DIR || path.join(__dirname, "..", "uploads"));

exports.uploadImage = async (file, folder) => {
  if (!/^(candidates|gallery\/(memory|entertainment|lantern|about))$/.test(folder)) {
    throw new AppError("Invalid image storage folder.", 400);
  }
  if (!extensions[file.mimetype] || !Buffer.isBuffer(file.buffer)) {
    throw new AppError("Only JPG, PNG or WebP images are allowed.", 400);
  }
  if (process.env.NODE_ENV === "production") return s3.uploadImage(file, folder);

  const filename = `${crypto.randomUUID()}.${extensions[file.mimetype]}`;
  const directory = path.join(exports.localUploadDirectory, folder);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, filename), file.buffer, { flag: "wx" });
  return `/uploads/${folder}/${filename}`;
};
