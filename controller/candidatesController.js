const Candidate = require("../model/candidatesModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");

exports.getAllCandidates = catchAsync(async (req, res) => {
  const candidates = await Candidate.find();

  res.status(200).json({
    status: "success",
    results: candidates.length,
    data: { candidates },
  });
});

exports.getCandidate = catchAsync(async (req, res, next) => {
  const candidate = await Candidate.findById(req.params.id);

  if (!candidate) {
    return next(new AppError("No candidate found with that ID", 404));
  }

  res.status(200).json({
    status: "success",
    data: { candidate },
  });
});

exports.createCandidate = catchAsync(async (req, res) => {
  const candidate = await Candidate.create(req.body);

  res.status(201).json({
    status: "success",
    data: { candidate },
  });
});

exports.updateCandidate = catchAsync(async (req, res, next) => {
  const candidate = await Candidate.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!candidate) {
    return next(new AppError("No candidate found with that ID", 404));
  }

  res.status(200).json({
    status: "success",
    data: { candidate },
  });
});

exports.deleteCandidate = catchAsync(async (req, res, next) => {
  const candidate = await Candidate.findByIdAndDelete(req.params.id);

  if (!candidate) {
    return next(new AppError("No candidate found with that ID", 404));
  }

  res.status(204).send();
});
