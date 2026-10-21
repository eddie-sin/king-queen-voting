const bcrypt = require("bcryptjs");
const Admin = require("../model/adminsModel");
const Election = require("../model/electionModel");
const Ballot = require("../model/ballotsModel");
const User = require("../model/usersModel");
const Credential = require("../model/voting_credentialsModel");
const Results = require("../model/resultsModel");
const Wish = require("../model/wishesModel");
const MemoryPhotoLike = require("../model/memoryPhotoLikesModel");

exports.seed = async () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required.");
  // Build the unique ballot index before accepting any requests.
  await Promise.all([Admin.init(), Election.init(), Ballot.init(), User.init(), Credential.init(), Results.init(), Wish.init(), MemoryPhotoLike.init()]);
  if (!(await Admin.exists({}))) {
    const username = process.env.ADMIN_USERNAME?.trim();
    const password = process.env.ADMIN_PASSWORD;
    if (!username || typeof password !== "string" || password.length < 8) {
      throw new Error("First startup requires ADMIN_USERNAME and ADMIN_PASSWORD (at least 8 characters).");
    }
    await Admin.updateOne({ username }, { $setOnInsert: {
      username,
      role: "ADMIN",
      passwordHash: await bcrypt.hash(password, 12),
      status: "active",
    } }, { upsert: true });
  }
  await Election.updateOne({ _id: "election" }, { $setOnInsert: {
    registrationClosesAt: new Date("2026-11-06T23:59:59.999+06:30"),
    votingOpensAt: new Date("2026-10-28T09:00:00.000+06:30"),
    votingClosesAt: new Date("2026-11-02T23:59:59.999+06:30"),
    resultsPublishedAt: new Date("2026-11-03T09:00:00.000+06:30"),
  } }, { upsert: true, runValidators: true });
};
