const mongoose = require('mongoose');

const stepSchema = new mongoose.Schema({
  step: Number,
  title: String,
  description: String,
  screenshot: String,
  imageUrl: String,
  video: String,
  videoSize: Number,
  candidates: [String],
  validCandidates: [String],
  picked: Number,
  annotated: Boolean,
  highlightLabel: String,
}, { _id: false });

const projectSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  topic: { type: String, required: true },
  status: {
    type: String,
    enum: ['draft', 'generating', 'ready', 'video_generating', 'complete', 'error'],
    default: 'draft',
  },
  tutorial: {
    title: String,
    url: String,
    source: String,
    wikiUrl: String,
    steps: [stepSchema],
  },
  sessionId: String,
  stats: {
    phase1Time: Number,
    phase2Time: Number,
    totalTime: Number,
  },
  error: String,
  isPublic: { type: Boolean, default: false },
  slug: { type: String, unique: true, sparse: true },
  category: { type: String, default: 'other' },
  tags: [String],
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
}, { timestamps: true });

// Auto-generate slug from topic
projectSchema.pre('save', function () {
  if (this.isModified('isPublic') && this.isPublic && !this.slug) {
    this.slug = this.topic
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80)
      + '-' + this._id.toString().slice(-6);
  }
});

// Indexes for explore queries
projectSchema.index({ user: 1, createdAt: -1 });
projectSchema.index({ isPublic: 1, status: 1, createdAt: -1 });
projectSchema.index({ isPublic: 1, status: 1, views: -1 });
projectSchema.index({ isPublic: 1, status: 1, likes: -1 });

projectSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Project', projectSchema);
