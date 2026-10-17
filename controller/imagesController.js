const Image = require("../model/imagesModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { uploadImage } = require("../utils/imageStorage");

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

  const urls = await Promise.all(
    req.files.map((file) => uploadImage(file, `gallery/${req.body.section}`)),
  );

  const images = await Image.create(
    urls.map((url) => ({
      url,
      section: req.body.section,
      caption: req.body.caption,
    })),
  );

  res.status(201).json({ status: "success", data: { images } });
});

exports.deleteImage = catchAsync(async (req, res, next) => {
  const image = await Image.findByIdAndDelete(req.params.id);

  if (!image) {
    return next(new AppError("No image found with that ID", 404));
  }

  res.status(204).send();
});
