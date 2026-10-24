const AppError = require("../utils/appError");

const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}.`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  return new AppError("This record already exists. Refresh before trying again.", 409);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  return new AppError(`Invalid input data. ${errors.join(". ")}`, 400);
};

const sendErrorDev = (err, res) => {
  res.status(err.statusCode || 500).json({
    status: err.status || "error",
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

const sendErrorProd = (err, res) => {
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  }

  console.error("Request failed:", err.name || "Error", "code:", err.code || "unknown");
  return res.status(500).json({
    status: "error",
    message: "Something went wrong!",
  });
};

module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  let error = err;

  if (error.name === "CastError") error = handleCastErrorDB(error);
  if (error.code === 11000) error = handleDuplicateFieldsDB(error);
  if (error.name === "ValidationError") {
    error = handleValidationErrorDB(error);
  }
  if (error.type === "entity.too.large") error = new AppError("Request body is too large.", 413);
  if (["MongoOperationTimeoutError", "MongoNetworkError", "MongoServerSelectionError"].includes(error.name)
      || error.hasErrorLabel?.("UnknownTransactionCommitResult")) {
    error = new AppError("The database response was interrupted. Refresh to confirm the outcome before retrying.", 503);
  }
  if (error.type === "entity.parse.failed") {
    error = new AppError("Request body must contain valid JSON.", 400);
  }
  if (error.name === "MulterError") {
    error = new AppError(error.message, 400);
  }

  if ((process.env.NODE_ENV || "development") === "development") {
    return sendErrorDev(error, res);
  }

  return sendErrorProd(error, res);
};
