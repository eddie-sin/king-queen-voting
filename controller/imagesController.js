const Image = require("../model/imagesModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const Vote = require('../model/lanternVotesModel');
const { staffMutation, getControls } = require('../utils/eventControls');
const guard = controls => { if(controls.lanternVotingOpen || controls.lanternAnnouncementOpen) throw new AppError('Close lantern voting and hide announcement before editing lanterns.',409); };
const { uploadImage, deleteImage } = require("../utils/imageStorage");

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
  if (Object.keys(req.query).some(k => k !== 'section') || req.query.section !== undefined &&
      (typeof req.query.section !== 'string' || !Image.schema.path('section').enumValues.includes(req.query.section))) {
    throw new AppError('Choose a valid gallery section.', 400);
  }
  const filter = req.query.section ? { section: req.query.section } : {};
  const images = await Image.find(filter).sort("-createdAt");

  res.status(200).json({
    status: "success",
    results: images.length,
    data: { images },
  });
});

exports.createImages = catchAsync(async (req, res, next) => {
  if(req.admin.role!=='admin' && req.body.section!=='lantern')throw new AppError('Only lanterns may be managed here.',403);
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

  guard(await getControls());
  const uploads = [];
  for (const file of req.files) {
    try { uploads.push({status:'fulfilled', value:await uploadImage(file, `gallery/${req.body.section}`)}); }
    catch (reason) { uploads.push({status:'rejected', reason}); break; }
  }
  const urls = uploads.filter(item=>item.status==='fulfilled').map(item=>item.value);
  const cleanup=()=>Promise.allSettled(urls.map(url=>deleteImage(url,`gallery/${req.body.section}`)));
  if(uploads.some(item=>item.status==='rejected')) { await cleanup(); throw new AppError('Image upload failed. Please retry.',503); }
  let images;
  try {

  images = await staffMutation(req, 'lantern.manage', async ({session,controls}) => { guard(controls); return Image.create(
    urls.map((url) => ({
      url,
      section: req.body.section,
      caption: req.body.caption,
      ...metadata,
    })), {session}); });

  } catch(error) { if(error.isOperational && error.statusCode<500 || error.name==='ValidationError')await cleanup(); throw error; }
  res.status(201).json({ status: "success", data: { images } });
});

exports.updateLantern = catchAsync(async (req, res, next) => {
  if (!req.body || Object.keys(req.body).some((field) => !["title", "description"].includes(field))) {
    return next(new AppError("Only lantern title and description can be updated.", 400));
  }
  const image = await staffMutation(req, 'lantern.manage', async ({session,controls})=>{ guard(controls);
  const image = await Image.findById(req.params.id).session(session);
  if (!image) throw new AppError("No image found with that ID", 404);
  if (image.section !== "lantern") throw new AppError("Only lantern metadata can be updated.", 400);
  const metadata = lanternMetadata({ title: req.body.title ?? image.title, description: req.body.description ?? image.description });
  image.title = metadata.title;
  image.description = metadata.description;
  await image.save({session}); return image; });
  res.status(200).json({ status: "success", data: { image } });
});

exports.deleteImage = catchAsync(async (req, res, next) => {
  const image = await staffMutation(req, 'lantern.manage', async ({session,controls})=>{ guard(controls);
    const target=await Image.findById(req.params.id).session(session);
    if(target && req.admin.role!=='admin' && target.section!=='lantern')throw new AppError('Only lanterns may be managed here.',403);
    if(await Vote.exists({lantern:req.params.id}).session(session))throw new AppError('A lantern with recorded votes cannot be deleted.',409);
    return Image.findByIdAndDelete(req.params.id).session(session);
  });

  if (!image) {
    return next(new AppError("No image found with that ID", 404));
  }

  try { await deleteImage(image.url, `gallery/${image.section}`); } catch { console.error('Gallery image cleanup pending.'); }
  res.status(204).send();
});
