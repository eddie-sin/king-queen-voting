const Candidate = require("../model/candidatesModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { uploadImage, deleteImage, isOwnedImage } = require("../utils/imageStorage");
const Ballot = require("../model/ballotsModel");
const { staffMutation, requireCandidateChanges, audit } = require("../utils/eventControls");
const { parsePhotoLayout, assertKeptPhotosExist, resolvePhotoLayout } = require("../utils/photoLayout");

const PHOTO_FOLDER = "candidates";
// Never delete a new upload while a transaction's commit outcome is unknown.
const definitelyRejected = error => error.isOperational && error.statusCode < 500
  || ['ValidationError', 'CastError'].includes(error.name) || error.code === 11000;
const editableFields = Object.keys(Candidate.schema.paths).filter((field) => !["_id", "__v"].includes(field));

// Multipart forms can only carry text, so they may send every field as one JSON
// value named "data" (keeps lists, numbers and booleans intact, including empty lists).
// Plain multipart fields and JSON bodies are still accepted.
const readBody = (req) => {
  let body = req.body || {};
  if (req.is("multipart/form-data") && typeof body.data === "string") {
    if (Object.keys(body).some((field) => field !== "data")) {
      throw new AppError("Send candidate fields either inside data or as separate fields, not both.", 400);
    }
    try { body = JSON.parse(body.data); } catch { throw new AppError("data must be valid JSON.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError("data must be a JSON object.", 400);
  }
  const { photoLayout, ...fields } = body;
  if (Object.keys(fields).some((field) => !editableFields.includes(field))) {
    throw new AppError("Only candidate information fields may be edited.", 400);
  }
  return { fields, photoLayout };
};

// Deletes stored photos that no candidate uses any more. Best effort: a failed
// delete (for example missing S3 permission) is logged and counted, never thrown,
// because the candidate change itself has already been saved.
const discardUnusedPhotos = async (urls) => {
  const outcome = { deleted: 0, failed: 0 };
  for (const url of new Set(urls)) {
    if (!isOwnedImage(url, PHOTO_FOLDER)) continue;
    try {
      if (await Candidate.exists({ images: url })) continue;
      if (await deleteImage(url, PHOTO_FOLDER)) outcome.deleted += 1;
    } catch (error) {
      outcome.failed += 1;
      console.error(`Could not delete candidate photo ${url}: ${error.name || "Error"} ${error.message || ""}`.trim());
    }
  }
  return outcome;
};

// Uploads in order. If any upload fails, the ones that succeeded are removed again.
const uploadPhotos = async (files = []) => {
  const settled = await Promise.allSettled(files.map((file) => uploadImage(file, PHOTO_FOLDER)));
  const urls = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const failure = settled.find((result) => result.status === "rejected");
  if (failure) {
    await discardUnusedPhotos(urls);
    throw failure.reason;
  }
  return urls;
};

exports.getAllCandidates = catchAsync(async (req, res) => {
  const candidates = await Candidate.find({ isActive: true });
  res.status(200).json({ status: "success", results: candidates.length, data: { candidates } });
});

exports.getCandidate = catchAsync(async (req, res) => {
  const candidate = await Candidate.findOne({ _id: req.params.id, isActive: true });
  if (!candidate) throw new AppError("No candidate found with that ID", 404);
  res.status(200).json({ status: "success", data: { candidate } });
});

exports.getAdminCandidates = catchAsync(async (req, res) => {
  const candidates = await Candidate.find().select("+contactNumber");
  res.status(200).json({ status: "success", results: candidates.length, data: { candidates } });
});

exports.getAdminCandidate = catchAsync(async (req, res) => {
  const candidate = await Candidate.findById(req.params.id).select("+contactNumber");
  if (!candidate) throw new AppError("No candidate found with that ID", 404);
  res.status(200).json({ status: "success", data: { candidate } });
});

exports.createCandidate = catchAsync(async (req, res) => {
  const { fields, photoLayout } = readBody(req);
  if (photoLayout !== undefined) throw new AppError("photoLayout is only used when editing a candidate.", 400);
  if (req.files?.length && fields.images !== undefined) {
    throw new AppError("Send photos either as uploaded files or as image URLs, not both.", 400);
  }
  if (Array.isArray(fields.images) && fields.images.some(url => isOwnedImage(url, PHOTO_FOLDER))) {
    throw new AppError("Upload new photos rather than reusing another candidate's managed image URL.", 400);
  }
  const uploaded = await uploadPhotos(req.files);
  if (uploaded.length) fields.images = uploaded;
  let candidate;
  try {
    candidate = await staffMutation(req, "candidates.create", async ({ session, controls, actor }) => {
      requireCandidateChanges(controls);
      const created = new Candidate(fields);
      await created.save({ session });
      await audit(session, actor, "candidates.create", { candidateId: String(created._id) });
      return created;
    });
  } catch (error) {
    if (definitelyRejected(error)) await discardUnusedPhotos(uploaded);
    throw error;
  }
  res.status(201).json({ status: "success", data: { candidate } });
});

// Photos change only through photoLayout: keep current photos and/or place new
// uploads, in the final order. Without photoLayout the photos are left untouched.
exports.updateCandidate = catchAsync(async (req, res) => {
  const { fields, photoLayout } = readBody(req);
  if (fields.images !== undefined) {
    throw new AppError("Photos cannot be set by URL when editing. Use photoLayout to keep, reorder or add uploaded photos.", 400);
  }
  const files = req.files || [];
  let layout = null;
  if (photoLayout !== undefined) layout = parsePhotoLayout(photoLayout, files.length);
  else if (files.length) throw new AppError("Uploaded photos need a photoLayout that says where each one goes.", 400);

  // Reject stale layouts before spending time on uploads; rechecked inside the queue below.
  if (layout) {
    const current = await Candidate.findById(req.params.id).select("images").lean();
    if (!current) throw new AppError("No candidate found with that ID", 404);
    assertKeptPhotosExist(layout, current.images);
  }

  const uploaded = await uploadPhotos(files);
  let removed = [];
  let candidate;
  try {
    candidate = await staffMutation(req, "candidates.update", async ({ session, controls, actor }) => {
      requireCandidateChanges(controls);
      const existing = await Candidate.findById(req.params.id).select("+contactNumber").session(session);
      if (!existing) throw new AppError("No candidate found with that ID", 404);
      if (fields.category && fields.category !== existing.category && await Ballot.exists({ candidate: existing._id }).session(session)) {
        throw new AppError("Clear all votes before changing this candidate's category.", 409);
      }
      Object.assign(existing, fields);
      if (layout) {
        const next = resolvePhotoLayout(layout, existing.images, uploaded);
        existing.images = next.images;
        removed = next.removed;
      }
      await existing.save({ session });
      await audit(session, actor, "candidates.update", { candidateId: String(existing._id) });
      return existing;
    });
  } catch (error) {
    // Keep old photos. Retain new objects if the commit could have succeeded;
    // a later scoped cleanup can handle genuinely unused uploads safely.
    removed = [];
    if (definitelyRejected(error)) await discardUnusedPhotos(uploaded);
    throw error;
  }
  const storageCleanup = await discardUnusedPhotos(removed);
  res.status(200).json({ status: "success", data: { candidate, storageCleanup } });
});

exports.deleteCandidate = catchAsync(async (req, res) => {
  const deleted = await staffMutation(req, "candidates.delete", async ({ session, controls, actor }) => {
    requireCandidateChanges(controls);
    if (await Ballot.exists({}).session(session)) throw new AppError("Clear all votes before deleting any candidate.", 409);
    const candidate = await Candidate.findById(req.params.id).select("+contactNumber").session(session).lean();
    if (!candidate) throw new AppError("No candidate found with that ID", 404);
    await Candidate.deleteOne({ _id: candidate._id }).session(session);
    await audit(session, actor, "candidates.delete", { candidateId: String(candidate._id) });
    return candidate;
  });
  await discardUnusedPhotos(deleted.images || []);
  res.status(204).send();
});
