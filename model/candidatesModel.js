const mongoose = require("mongoose");

const candidateSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, "Candidate full name is required"],
    trim: true,
  },
  batchNumber: {
    type: String,
    trim: true,
  },
  nickname: {
    type: String,
    trim: true,
  },
  images: {
    type: [String],
    required: [true, "At least one candidate image is required"],
    validate: {
      validator(images) {
        return (
          images.length >= 1 &&
          images.length <= 3 &&
          images.every((image) => typeof image === "string" && image.trim()) &&
          new Set(images).size === images.length
        );
      },
      message: "Candidates need 1 to 3 different, non-empty images",
    },
  },
  bio: {
    type: String,
    trim: true,
  },
  age: {
    type: Number,
    min: [1, "Age must be greater than 0"],
  },
  zodiacSign: {
    type: String,
    trim: true,
  },
  hobbiesAndInterests: {
    type: [String],
    default: undefined,
  },
  contactNumber: {
    type: String,
    trim: true,
    select: false, // private: never expose in public API responses
  },
  category: {
    type: String,
    required: [true, "Candidate category is required"],
    enum: ["king", "queen"],
  },
  isActive: {
    type: Boolean,
    default: true,
  },
});

module.exports = mongoose.model("Candidate", candidateSchema);
