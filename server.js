process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION! Shutting down...");
  console.error(err.stack);
  process.exit(1);
});

const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: "./config.env" });

const app = require("./app");
const { seed } = require("./utils/seed");
const admission = require("./utils/voteAdmission");

let databaseConnection;

if (process.env.NODE_ENV === "development") {
  databaseConnection = process.env.DATABASE_LOCAL;
  console.log("Using local MongoDB");
} else {
  if (!process.env.DATABASE) {
    console.error(
      "Production database is not configured. Add your cloud MongoDB connection string to DATABASE in config.env.",
    );
    process.exit(1);
  }

  databaseConnection = process.env.DATABASE;

  if (databaseConnection.includes("<db_password>")) {
    if (!process.env.DATABASE_PASSWORD) {
      console.error(
        "DATABASE_PASSWORD is missing. Add your cloud MongoDB password to config.env.",
      );
      process.exit(1);
    }

    databaseConnection = databaseConnection.replace(
      "<db_password>",
      encodeURIComponent(process.env.DATABASE_PASSWORD),
    );
  }

  console.log("Using cloud MongoDB");
}

let server;

mongoose
  .connect(databaseConnection, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 })
  .then(async () => {
    console.log("Database connection successful");

    await seed();
    require('./utils/accounts/mail').start();
    const port = process.env.PORT || 5000;
    server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
      console.log(
        `Server running on port ${port} in ${process.env.NODE_ENV} mode`,
      );
    });

  })
  .catch((err) => {
    console.error("Server startup failed:", err.message);
    process.exit(1);
  });

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION! Shutting down...");
  console.error(err.name,err.message);

  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  admission.close();
  require('./utils/accounts/mail').stop();
  const deadline = setTimeout(() => process.exit(1), 20000);
  deadline.unref();
  if (server) await new Promise(resolve => server.close(resolve));
  await admission.drain();
  await mongoose.disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
