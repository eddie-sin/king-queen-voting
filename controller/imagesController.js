const Image = require("../model/imagesModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { uploadImage } = require("../utils/imageStorage");

const lanternMetadata = (body) => {
  if (body.description !== undefined && typeof body.description !== "string") {
    throw new AppError("Lantern description must be text.", 400);
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!title) throw new AppError("Lantern title is required.", 400);
  if (title.length > 120) throw new AppError("Lantern title cannot exceed 120 characters.", 400);
  if (description.length > 1000) throw new AppError("Lantern description cannot exceed 1000 characters.", 400);
  return { title, description };
};

exports.getImages = catchAsync(async (req, res) => {
  const filter = req.query.section ? { section: req.query.section } : {};
  const images = await Image.find(filter).sort("-createdAt");

  res.status(200).json({
    status: "success",
    results: images.length,
    data: { images },
  });
});

exports.createImages = catchAsync(async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return next(new AppError("Please upload at least one image", 400));
  }
  if (!Image.schema.path("section").enumValues.includes(req.body.section)) {
    return next(new AppError("Image section must be memory, entertainment, lantern, or about.", 400));
  }
  let metadata = {};
  if (req.body.section === "lantern") {
    if (req.files.length !== 1) return next(new AppError("Please upload exactly one lantern image.", 400));
    metadata = lanternMetadata(req.body);
  }

  const urls = await Promise.all(
    req.files.map((file) => uploadImage(file, `gallery/${req.body.section}`)),
  );

  const images = await Image.create(
    urls.map((url) => ({
      url,
      section: req.body.section,
      caption: req.body.caption,
      ...metadata,
    })),
  );

  res.status(201).json({ status: "success", data: { images } });
});

exports.updateLantern = catchAsync(async (req, res, next) => {
  if (!req.body || Object.keys(req.body).some((field) => !["title", "description"].includes(field))) {
    return next(new AppError("Only lantern title and description can be updated.", 400));
  }
  const image = await Image.findById(req.params.id);
  if (!image) return next(new AppError("No image found with that ID", 404));
  if (image.section !== "lantern") return next(new AppError("Only lantern metadata can be updated.", 400));
  const metadata = lanternMetadata({ title: req.body.title ?? image.title, description: req.body.description ?? image.description });
  image.title = metadata.title;
  image.description = metadata.description;
  await image.save();
  res.status(200).json({ status: "success", data: { image } });
});

exports.deleteImage = catchAsync(async (req, res, next) => {
  const image = await Image.findByIdAndDelete(req.params.id);

  if (!image) {
    return next(new AppError("No image found with that ID", 404));
  }

  res.status(204).send();
});
