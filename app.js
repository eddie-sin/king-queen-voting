const express = require("express");
const morgan = require("morgan");

const candidatesRouter = require("./route/candidatesRoutes");
const AppError = require("./utils/appError");
const globalErrorHandler = require("./controller/errorControllers");

const app = express();

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

app.use(express.json());

app.use("/api/v1/candidates", candidatesRouter);

app.use((req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
