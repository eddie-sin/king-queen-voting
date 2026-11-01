const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  _id: { type: String, default: 'event' },
  schemaVersion: { type: Number, required: true, default: 2, enum: [2] },
  lanternVotingOpen: { type: Boolean, default: false },
  lanternAnnouncementOpen: { type: Boolean, default: false },
  lanternWindow: { type: Number, default: 0 },
  wishModerationRevision: { type:Number, default:0 },
  wishPostingOpen: { type:Boolean, default:true },
  registrationOpen: { type: Boolean, default: false },
  votingStatus: { type: String, enum: ['closed', 'open', 'closing'], default: 'closed' },
  announcementOpen: { type: Boolean, default: false },
  memoryPhotosEnabled: { type: Boolean, default: false },
  round: { type: Number, default: 1, min: 1 },
  window: { type: Number, default: 0, min: 0 },
  revision: { type: Number, default: 0, min: 0 },
  fence: { type: Number, default: 0, min: 0, select: false },
}, { timestamps: true });
schema.pre('validate', function () {
  if (this.lanternVotingOpen && this.lanternAnnouncementOpen) this.invalidate('lanternVotingOpen', 'Hide lantern announcement before opening voting.');
  if (this.announcementOpen && this.votingStatus !== 'closed') {
    this.invalidate('announcementOpen', 'Close voting before opening announcement.');
  }
});
module.exports = mongoose.model('EventControls', schema);
