const mongoose = require("mongoose");

const agendaSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Agenda title is required"],
      trim: true,
      maxlength: [120, "Title must be 120 characters or fewer"],
    },
    performer: {
      type: String,
      trim: true,
      maxlength: [120, "Performer must be 120 characters or fewer"],
      default: "",
    },
    startTime: {
      type: String,
      trim: true,
      // Optional, local event time in 24-hour format, for example 18:30.
      validate: {
        validator: (value) => !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
        message: "startTime must use HH:MM (24-hour time)",
      },
      default: "",
    },
    location: {
      type: String,
      trim: true,
      maxlength: [120, "Location must be 120 characters or fewer"],
      default: "",
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description must be 1000 characters or fewer"],
      default: "",
    },
    // Display order is separate from the time. The public GET route sorts on it.
    order: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { timestamps: true }
);

agendaSchema.index({ order: 1, _id: 1 });

module.exports = mongoose.model("Agenda", agendaSchema);
