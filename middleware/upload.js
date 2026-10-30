const multer = require("multer");
const AppError = require("../utils/appError");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10, fields: 8, fieldSize: 32768, parts: 18 },
  fileFilter(req, file, cb) {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return cb(null, true);
    }
    cb(new AppError("Only JPG, PNG or WebP images are allowed", 400));
  },
});

// Expects multipart field name "images" (1-3 files).
exports.candidateImages = upload.array("images", 3);

// Expects multipart fields "images" (up to 10 files), "section", optional "caption".
exports.galleryImages = upload.array("images", 10);

// One image per student submission, with the existing formats and size cap.
// MongoDB reservations separately enforce the lifetime submission allowance.
exports.memoryPhotoImages = upload.array("images", 1);
