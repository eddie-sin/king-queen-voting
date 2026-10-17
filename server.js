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
const { finalizeResultsIfDue } = require("./utils/results");

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
  .then(async () => {
    console.log("Database connection successful");

    const topology = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!topology.setName && topology.msg !== "isdbgrid") {
      throw new Error("Voting requires MongoDB transactions. Use MongoDB Atlas or a local replica set; see README.md.");
    }
    await seed();
    await finalizeResultsIfDue();

    let maintaining = false;
    const maintenance = setInterval(async () => {
      if (maintaining) return;
      maintaining = true;
      try {
        await finalizeResultsIfDue();
      } catch (error) {
        console.error("Election maintenance failed:", error.message);
      } finally {
        maintaining = false;
      }
    }, 15000);
    maintenance.unref();

    const port = process.env.PORT || 5000;
    server = app.listen(port, () => {
      console.log(
        `Server running on port ${port} in ${process.env.NODE_ENV} mode`,
      );
    });
    server.on("close", () => clearInterval(maintenance));
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
