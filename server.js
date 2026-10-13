process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION! Shutting down...");
  console.error(err.name, err.message);
  process.exit(1);
});

const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: "./config.env" });

const app = require("./app");

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
  .connect(databaseConnection)
  .then(() => {
    console.log("Database connection successful");

    const port = process.env.PORT || 5000;
    server = app.listen(port, () => {
      console.log(
        `Server running on port ${port} in ${process.env.NODE_ENV} mode`,
      );
    });
  })
  .catch((err) => {
    console.error("Database connection failed:", err.message);
    process.exit(1);
  });

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION! Shutting down...");
  console.error(err.name, err.message);

  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});
