const mongoose = require("mongoose");

const SETTINGS_ID = "memory-photo-settings";
const closingFields = ["uploadsCloseAt", "likesCloseAt", "galleryClosesAt"];

const memoryPhotoSettingsSchema = new mongoose.Schema({
  _id: { type: String, default: SETTINGS_ID, enum: [SETTINGS_ID] },
  enabled: { type: Boolean, default: false },
  opensAt: { type: Date, default: null },
  uploadsCloseAt: { type: Date, default: null },
  likesCloseAt: { type: Date, default: null },
  galleryClosesAt: { type: Date, default: null },
});

memoryPhotoSettingsSchema.pre("validate", function validateMemoryPhotoSettings() {
  if (this.enabled && !this.opensAt) {
    this.invalidate("opensAt", "An opening time is required before Memory Photo can be enabled.");
  }
  for (const field of closingFields) {
    if (!this[field]) continue;
    if (!this.opensAt) {
      this.invalidate(field, `${field} requires an opening time.`);
    } else if (this[field] <= this.opensAt) {
      this.invalidate(field, `${field} must be after opensAt.`);
    }
  }
});

const MemoryPhotoSettings = mongoose.model("MemoryPhotoSettings", memoryPhotoSettingsSchema);
MemoryPhotoSettings.SETTINGS_ID = SETTINGS_ID;

module.exports = MemoryPhotoSettings;
