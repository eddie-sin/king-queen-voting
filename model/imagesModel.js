const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema({
  section: {
    type: String,
    required: [true, "Image section is required"],
    enum: ["memory", "entertainment", "lantern", "about"],
  },
  url: { type: String, required: [true, "Image url is required"] },
  caption: { type: String, trim: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Image", imageSchema);
