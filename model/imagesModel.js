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
  thumbnailPosition: { type: new mongoose.Schema({
    x: { type: Number, min: 0, max: 100, required: true },
    y: { type: Number, min: 0, max: 100, required: true },
  }, { _id: false }), default: undefined },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Image", imageSchema);
