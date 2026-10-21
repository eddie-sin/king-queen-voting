const AppError = require("./appError");

// A photo layout is the final, ordered list of a candidate's photos after an edit.
// Each entry either keeps one of the candidate's current photos or places one of
// the files uploaded in the same request:
//   [{ keep: "<current photo URL>" }, { upload: 0 }, ...]
exports.MAX_PHOTOS = 3;

const parseJson = (raw) => {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { throw new AppError("photoLayout must be valid JSON.", 400); }
};

// Shape checks only; needs no database access, so bad requests fail before any upload.
exports.parsePhotoLayout = (raw, fileCount) => {
  const value = parseJson(raw);
  if (!Array.isArray(value) || value.length < 1 || value.length > exports.MAX_PHOTOS) {
    throw new AppError(`photoLayout must list 1 to ${exports.MAX_PHOTOS} photos.`, 400);
  }
  const kept = new Set();
  const placed = new Set();
  const layout = value.map((entry) => {
    const keys = entry && typeof entry === "object" && !Array.isArray(entry) ? Object.keys(entry) : [];
    if (keys.length !== 1 || !["keep", "upload"].includes(keys[0])) {
      throw new AppError("Each photoLayout entry must be either { keep: <photo URL> } or { upload: <file number> }.", 400);
    }
    if (keys[0] === "keep") {
      if (typeof entry.keep !== "string" || !entry.keep) throw new AppError("photoLayout keep entries need a photo URL.", 400);
      if (kept.has(entry.keep)) throw new AppError("The same photo cannot be used twice.", 400);
      kept.add(entry.keep);
      return { keep: entry.keep };
    }
    if (!Number.isInteger(entry.upload) || entry.upload < 0 || entry.upload >= fileCount) {
      throw new AppError("photoLayout refers to an uploaded photo that was not sent.", 400);
    }
    if (placed.has(entry.upload)) throw new AppError("The same uploaded photo cannot be used twice.", 400);
    placed.add(entry.upload);
    return { upload: entry.upload };
  });
  if (placed.size !== fileCount) {
    throw new AppError("Every uploaded photo must be placed in photoLayout.", 400);
  }
  return layout;
};

// Kept photos must still belong to the candidate; otherwise someone changed them meanwhile.
exports.assertKeptPhotosExist = (layout, currentImages) => {
  const current = new Set(currentImages);
  if (layout.some((entry) => "keep" in entry && !current.has(entry.keep))) {
    throw new AppError("This candidate's photos changed since you opened it. Reload and try again.", 409);
  }
};

// Returns the final photo URLs and the current photos that are no longer used.
exports.resolvePhotoLayout = (layout, currentImages, uploadedUrls) => {
  exports.assertKeptPhotosExist(layout, currentImages);
  const images = layout.map((entry) => ("keep" in entry ? entry.keep : uploadedUrls[entry.upload]));
  const removed = [...currentImages].filter((url) => !images.includes(url));
  return { images, removed };
};
