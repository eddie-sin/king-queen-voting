const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema({
  section: {
    type: String,
    required: [true, "Image section is required"],
    enum: ["memory", "entertainment", "lantern", "about"],
  },
  url: { type: String, required: [true, "Image url is required"] },
  caption: { type: String, trim: true },
  title: {
    type: String,
    trim: true,
    maxlength: [120, "Lantern title cannot exceed 120 characters"],
    required() { return this.isNew && this.section === "lantern"; },
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, "Lantern description cannot exceed 1000 characters"],
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Image", imageSchema);
