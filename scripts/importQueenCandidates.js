const fs = require("fs/promises");
const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", "config.env") });

const Candidate = require("../model/candidatesModel");

const root = path.resolve(__dirname, "..", "Candidates", "Queen Candidates");
const uploadDirectory = path.resolve(process.env.LOCAL_UPLOAD_DIR || path.join(__dirname, "..", "uploads"), "candidates");

const candidates = [
  {
    folder: "Candidate1",
    fullName: "Suyati Linn",
    batchNumber: "Guf 97",
    age: 18,
    photos: ["photo_2026-10-19_09-56-02.jpg", "photo_2026-10-18_23-45-41.jpg", "photo_2026-10-18_23-45-41 (2).jpg"],
  },
  {
    folder: "Candidate2",
    fullName: "Ei Thwel Shin Thant",
    age: 14,
    photos: ["photo_2026-10-18_23-46-22.jpg", "photo_2026-10-18_23-46-23.jpg", "photo_2026-10-18_23-46-23 (2).jpg"],
  },
  {
    folder: "Candidate3",
    fullName: "Thiri San",
    nickname: "Jel",
    batchNumber: "Batch 6",
    age: 20,
    zodiacSign: "Capricorn",
    bio: "A friendly and cheerful person who enjoys spreading positivity and creating happy memories",
    hobbiesAndInterests: ["Traveling"],
    photos: ["photo_2026-10-18_23-47-13.jpg", "photo_2026-10-18_23-47-13 (2).jpg", "photo_2026-10-18_23-47-14.jpg"],
  },
  {
    folder: "Candidate4",
    fullName: "Kyal Sin San",
    batchNumber: "Guf 98",
    age: 18,
    photos: ["photo_2026-10-18_23-47-46.jpg", "photo_2026-10-18_23-47-47.jpg", "photo_2026-10-18_23-47-47 (2).jpg"],
  },
];

async function main() {
  if (!process.env.DATABASE_LOCAL) throw new Error("DATABASE_LOCAL is required in config.env.");
  await fs.mkdir(uploadDirectory, { recursive: true });
  await mongoose.connect(process.env.DATABASE_LOCAL);

  for (const [candidateIndex, candidate] of candidates.entries()) {
    const images = [];
    for (const [imageIndex, filename] of candidate.photos.entries()) {
      const extension = path.extname(filename).toLowerCase();
      const storedName = `queen-candidate-${candidateIndex + 1}-${imageIndex + 1}${extension}`;
      await fs.copyFile(path.join(root, candidate.folder, filename), path.join(uploadDirectory, storedName));
      images.push(`/uploads/candidates/${storedName}`);
    }

    const record = { ...candidate, category: "queen", isActive: true, images };
    delete record.folder;
    delete record.photos;
    await Candidate.findOneAndUpdate(
      { fullName: record.fullName, category: "queen" },
      { $set: record },
      { upsert: true, returnDocument: "after", runValidators: true },
    );
  }

  console.log(`Imported ${candidates.length} Queen candidates.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
