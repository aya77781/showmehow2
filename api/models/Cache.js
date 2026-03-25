const mongoose = require('mongoose');

const cacheSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['script', 'image_search', 'image_pick', 'annotation', 'tts'],
    required: true,
    index: true,
  },
  key: { type: String, required: true, index: true },
  value: mongoose.Schema.Types.Mixed,
  buffer: Buffer,
  hits: { type: Number, default: 0 },
  expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
}, { timestamps: true });

cacheSchema.index({ type: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('Cache', cacheSchema);
