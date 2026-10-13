const mongoose = require("mongoose");

const candidateSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, "Candidate full name is required"],
    trim: true,
  },
  batchNumber: {
    type: String,
    required: [true, "Candidate batch number is required"],
    trim: true,
  },
  nickname: {
    type: String,
    trim: true,
  },
  images: {
    type: [String],
    required: [true, "Three candidate images are required"],
    validate: {
      validator(images) {
        return (
          images.length === 3 &&
          images.every((image) => typeof image === "string" && image.trim())
        );
      },
      message: "Exactly three non-empty candidate images are required",
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
    required: [true, "Viber phone number or contact number is required"],
    trim: true,
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
