const multer = require("multer");
const AppError = require("../utils/appError");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) return callback(null, true);
    return callback(new AppError(file.mimetype === "image/heic" || file.mimetype === "image/heif"
      ? "HEIC images are not supported yet. Please upload JPEG, PNG, or WebP."
      : "Only JPEG, PNG, or WebP images are allowed.", 400));
  },
});

exports.memoryPhoto = upload.single("photo");

const activeAccounts = new Set();
exports.memoryPhotoUploadGate = (req, res, next) => {
  const key = String(req.userId);
  if (activeAccounts.has(key)) return next(new AppError("A Memory Photo upload is already in progress for this account.", 429));
  activeAccounts.add(key);
  let active = true;
  const release = () => {
    if (!active) return;
    active = false;
    activeAccounts.delete(key);
  };
  res.once("finish", release);
  res.once("close", release);
  return next();
};
