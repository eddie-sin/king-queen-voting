// Explicit one-time test cutover. Defaults to read-only. Never drops a database.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
require("dotenv").config({
  path: path.resolve(__dirname, "../config.env"),
  quiet: true,
});
const mongoose = require("mongoose");
const collections = [
  "users",
  "ballots",
  "lanternvotes",
  "wishes",
  "memoryphotos",
  "memoryphotolikes",
  "memoryphotoquotas",
  "studentsessions",
  "authflows",
  "authmails",
];
async function main() {
  const cloud = process.argv.includes("--cloud"),
    apply = process.argv.includes("--apply");
  process.env.NODE_ENV = cloud ? "production" : "development";
  const uri = (
    cloud ? process.env.DATABASE : process.env.DATABASE_LOCAL
  )?.replace(
    "<db_password>",
    encodeURIComponent(process.env.DATABASE_PASSWORD || ""),
  );
  await mongoose.connect(uri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 5000,
  });
  const db = mongoose.connection.db;
  if (db.databaseName !== "king_queen_voting_v2")
    throw new Error("Refusing unexpected target database.");
  const snapshot = {
    database: db.databaseName,
    target: cloud ? "cloud" : "local",
    createdAt: new Date().toISOString(),
    collections: {},
  };
  for (const name of collections)
    snapshot.collections[name] = await db.collection(name).find({}).toArray();
  console.log(
    JSON.stringify({
      target: snapshot.target,
      database: db.databaseName,
      mode: apply ? "apply" : "dry-run",
      remove: Object.fromEntries(
        collections.map((name) => [name, snapshot.collections[name].length]),
      ),
      keep: {
        staff: await db.collection("admins").countDocuments(),
        candidates: await db.collection("candidates").countDocuments(),
        gallery: await db.collection("images").countDocuments(),
      },
    }),
  );
  if (!apply) return;
  const dir = path.join(
    os.homedir(),
    ".local/state/king-queen-voting/auth-cutover",
    `${Date.now()}-${snapshot.target}`,
  );
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  await fs.writeFile(
    path.join(dir, "snapshot.json"),
    JSON.stringify(snapshot),
    { mode: 0o600, flag: "wx" },
  );
  const keys = [
    ...new Set(
      snapshot.collections.memoryphotos.map((p) => p.imageKey).filter(Boolean),
    ),
  ];
  await fs.writeFile(
    path.join(dir, "memory-cleanup.json"),
    JSON.stringify({ keys }),
    { mode: 0o600, flag: "wx" },
  );
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await db
        .collection("eventcontrols")
        .updateOne(
          { _id: "event" },
          {
            $set: {
              registrationOpen: false,
              votingStatus: "closed",
              announcementOpen: false,
              lanternVotingOpen: false,
              lanternAnnouncementOpen: false,
              memoryPhotosEnabled: false,
            },
            $inc: {
              round: 1,
              window: 1,
              lanternWindow: 1,
              revision: 1,
              fence: 1,
            },
          },
          { session },
        );
      for (const name of collections) {
        const ids = snapshot.collections[name].map((doc) => doc._id);
        if (ids.length)
          await db
            .collection(name)
            .deleteMany({ _id: { $in: ids } }, { session });
      }
    });
  } finally {
    await session.endSession();
  }
  const storage = require("../utils/memoryPhotoStorage");
  const failed = [];
  for (const key of keys)
    try {
      await storage.deleteImage(key);
    } catch {
      failed.push(key);
    }
  await fs.writeFile(
    path.join(dir, "memory-cleanup.json"),
    JSON.stringify({ keys: failed, databaseResetConfirmed: true }),
    { mode: 0o600 },
  );
  console.log(
    `Student test reset complete. Private recovery files: ${dir}. Pending image removals: ${failed.length}. Email budget counters preserved.`,
  );
}
main()
  .catch((e) => {
    console.error("Reset stopped:", e.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
