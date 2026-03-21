const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Project = require('../models/Project');
const Anthropic = require('@anthropic-ai/sdk');
const claude = new Anthropic();

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

// PUT /api/tutorials/:id/pick-image — user picks a different candidate image for a step
router.put('/:id/pick-image', auth, async (req, res) => {
  const { stepIndex, candidateFile } = req.body;
  const project = await Project.findOne({ _id: req.params.id, user: req.user.id });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.sessionId) return res.status(400).json({ error: 'No session' });

  const step = project.tutorial?.steps?.[stepIndex];
  if (!step) return res.status(400).json({ error: 'Invalid step index' });
  if (!step.candidates?.includes(candidateFile)) return res.status(400).json({ error: 'Invalid candidate' });

  const fs = require('fs');
  const path = require('path');
  const imgDir = path.resolve(__dirname, '..', 'output', 'sessions', project.sessionId, 'images');
  const stepNum = String(step.step).padStart(2, '0');
  const mainFile = `step-${stepNum}.png`;

  // Copy the chosen candidate as the main screenshot
  fs.copyFileSync(path.join(imgDir, candidateFile), path.join(imgDir, mainFile));
  step.screenshot = mainFile;
  step.picked = step.candidates.indexOf(candidateFile);
  await project.save();

  res.json({ ok: true, step: step.step, screenshot: mainFile, picked: step.picked });
});

// POST /api/tutorials/:id/chat — RAG chat about the tutorial topic
router.post('/:id/chat', auth, async (req, res) => {
  const { message, history } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

  const project = await Project.findOne({ _id: req.params.id, user: req.user.id });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const tutorial = project.tutorial || {};
  const stepsContext = (tutorial.steps || [])
    .map(s => `Step ${s.step}: ${s.title} — ${s.description}`)
    .join('\n');

  const systemPrompt = `You are a helpful AI tutor for the topic: "${project.topic}".

Here is the tutorial that was generated for this topic:
Title: ${tutorial.title || project.topic}
URL: ${tutorial.url || 'N/A'}
Steps:
${stepsContext}

RULES:
- ONLY answer questions related to "${project.topic}" and closely related subjects.
- If the user asks about something completely unrelated, politely redirect them back to the topic.
- Use web_search when you need up-to-date information or to verify facts about this topic.
- Be concise and practical. Give actionable answers.
- Reference specific steps from the tutorial when relevant.
- Answer in the same language the user writes in.`;

  // Build messages from history
  const messages = [];
  if (history?.length) {
    for (const h of history.slice(-20)) { // last 20 messages max
      messages.push({ role: h.role, content: h.content });
    }
  }
  messages.push({ role: 'user', content: message.trim() });

  try {
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages,
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .replace(/<[^>]+>/g, '') // strip cite tags
      .trim();

    res.json({ reply: text });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Failed to get response' });
  }
});

// DELETE /api/tutorials/:id
router.delete('/:id', auth, async (req, res) => {
  const project = await Project.findOneAndDelete({ _id: req.params.id, user: req.user.id });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ message: 'Project deleted' });
});

module.exports = router;
