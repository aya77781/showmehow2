const mongoose = require('mongoose');

const stepSchema = new mongoose.Schema({
  step: Number,
  title: String,
  description: String,
  screenshot: String,
  imageUrl: String,
  video: String,
  videoSize: Number,
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
}, { timestamps: true });

projectSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Project', projectSchema);
