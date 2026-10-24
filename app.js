const express = require("express");
const morgan = require("morgan");

const authRouter = require("./route/authRoutes");
const candidatesRouter = require("./route/candidatesRoutes");
const imagesRouter = require("./route/imagesRoutes");
const AppError = require("./utils/appError");
const globalErrorHandler = require("./controller/errorControllers");
const votingRouter = require("./route/votingRoutes");

const app = express();

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Only the local Nginx reverse proxy may supply forwarded client addresses.
app.set("trust proxy", "loopback");
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  // Authenticated selections and unreleased results must not be cached.
  res.set("Cache-Control", "no-store");
  next();
});

if (process.env.NODE_ENV !== "production") {
  app.use("/uploads", express.static(require("./utils/imageStorage").localUploadDirectory, {
    dotfiles: "deny",
    index: false,
    setHeaders(res) { res.set("X-Content-Type-Options", "nosniff"); },
  }));
}

app.use("/api/v1/voting", votingRouter);
app.use("/api/v1/auth", authRouter);

app.use("/api/v1/candidates", candidatesRouter);
app.use("/api/v1/images", imagesRouter);
app.use("/api/v1/wishes", require("./route/wishesRoutes"));
app.use("/api/v1/memory-photos", require("./route/memoryPhotosRoutes"));
app.use("/api/v1/admin", require("./route/adminRoutes"));
app.get("/api/v1/settings", require("./controller/settingsController").getSettings);
app.get("/api/v1/results", require("./controller/resultsController").getResults);

app.use((req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
