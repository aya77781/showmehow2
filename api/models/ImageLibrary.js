const mongoose = require('mongoose');

const imageLibrarySchema = new mongoose.Schema({
  // Identity
  hash: { type: String, required: true, unique: true },
  buffer: { type: Buffer, required: true },
  mime: { type: String, default: 'image/jpeg' },
  width: Number,
  height: Number,

  // Semantic metadata
  site: { type: String, index: true },           // "github", "gmail", "figma"
  page: String,                                    // "new repository page", "compose window"
  element: String,                                 // "name input field", "send button"
  tags: { type: [String], index: true },          // ["github", "repository", "create", "button"]
  originalQuery: String,                           // original imageQuery used

  // Quality
  validated: { type: Boolean, default: true },     // passed Claude Vision check
  annotationData: {                                // cached annotation if available
    x1p: Number, y1p: Number, x2p: Number, y2p: Number,
    label: String,
  },

  // Stats
  uses: { type: Number, default: 1 },
  lastUsed: { type: Date, default: Date.now },
}, { timestamps: true });

// Text index for semantic search across tags, site, page, element
imageLibrarySchema.index({ site: 1, tags: 1 });
imageLibrarySchema.index({ tags: 'text', site: 'text', page: 'text', element: 'text' });

module.exports = mongoose.model('ImageLibrary', imageLibrarySchema);
