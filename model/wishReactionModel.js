const mongoose = require('mongoose');

const wishReactionSchema = new mongoose.Schema({
  wish: { type: mongoose.Schema.Types.ObjectId, ref: 'Wish', required: true },
  browser: { type: String, required: true, select: false },
});

wishReactionSchema.index({ wish: 1, browser: 1 }, { unique: true });

module.exports = mongoose.model('WishReaction', wishReactionSchema);
