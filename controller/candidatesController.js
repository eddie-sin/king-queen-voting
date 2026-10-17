const Candidate = require("../model/candidatesModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { uploadImage } = require("../utils/s3");
const { withElectionTransaction } = require("../utils/election");

const editableFields = Object.keys(Candidate.schema.paths).filter((field) => !["_id", "__v"].includes(field));
const candidateInput = async (req) => {
  const input = { ...(req.body || {}) };
  if (Object.keys(input).some((field) => !editableFields.includes(field))) {
    throw new AppError("Only candidate information fields may be edited.", 400);
  }
  if (req.files?.length) {
    input.images = await Promise.all(req.files.map((file) => uploadImage(file, "candidates")));
  }
  return input;
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
  const input = await candidateInput(req);
  const candidate = await withElectionTransaction("candidate", async ({ session }) => {
    const [created] = await Candidate.create([input], { session });
    return created;
  });
  res.status(201).json({ status: "success", data: { candidate } });
});

exports.updateCandidate = catchAsync(async (req, res) => {
  const input = await candidateInput(req);
  const candidate = await withElectionTransaction("candidate", async ({ session }) => {
    const existing = await Candidate.findById(req.params.id).select("+contactNumber").session(session);
    if (!existing) throw new AppError("No candidate found with that ID", 404);
    Object.assign(existing, input);
    await existing.save({ session });
    return existing;
  });
  res.status(200).json({ status: "success", data: { candidate } });
});

exports.deleteCandidate = catchAsync(async (req, res) => {
  await withElectionTransaction("candidate", async ({ session }) => {
    const candidate = await Candidate.findByIdAndDelete(req.params.id, { session });
    if (!candidate) throw new AppError("No candidate found with that ID", 404);
  });
  res.status(204).send();
});
