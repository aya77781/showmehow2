const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Project = require('../models/Project');

// GET /api/tutorials — list user's projects
router.get('/', auth, async (req, res) => {
  const projects = await Project.find({ user: req.user.id }).sort({ createdAt: -1 });
  res.json(projects);
});

// GET /api/tutorials/:id — get single project
router.get('/:id', auth, async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id, user: req.user.id });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// POST /api/tutorials — create project (just saves topic, socket handles generation)
router.post('/', auth, async (req, res) => {
  const { topic } = req.body;
  if (!topic?.trim()) return res.status(400).json({ error: 'Topic is required' });

  const project = await Project.create({
    user: req.user.id,
    topic: topic.trim(),
    status: 'draft',
  });

  res.status(201).json(project);
});

// PUT /api/tutorials/:id/steps — update steps (user edits before video generation)
router.put('/:id/steps', auth, async (req, res) => {
  const { steps } = req.body;
  if (!steps?.length) return res.status(400).json({ error: 'Steps are required' });

  const project = await Project.findOne({ _id: req.params.id, user: req.user.id });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  project.tutorial.steps = steps;
  await project.save();
  res.json(project);
});

// DELETE /api/tutorials/:id
router.delete('/:id', auth, async (req, res) => {
  const project = await Project.findOneAndDelete({ _id: req.params.id, user: req.user.id });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ message: 'Project deleted' });
});

module.exports = router;
