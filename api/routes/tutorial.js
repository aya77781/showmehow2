const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Project = require('../models/Project');
const Anthropic = require('@anthropic-ai/sdk');
const claude = new Anthropic();

// GET /api/tutorials — list user's projects
router.get('/', auth, async (req, res) => {
  try {
    const projects = await Project.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) {
    console.error('List projects error:', err);
    res.status(500).json({ error: 'Failed to load projects' });
  }
});

// GET /api/tutorials/:id — get single project
router.get('/:id', auth, async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, user: req.user.id });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    console.error('Get project error:', err);
    res.status(500).json({ error: 'Failed to load project' });
  }
});

// POST /api/tutorials — create project (just saves topic, socket handles generation)
router.post('/', auth, async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic?.trim()) return res.status(400).json({ error: 'Topic is required' });

    const project = await Project.create({
      user: req.user.id,
      topic: topic.trim(),
      status: 'draft',
    });

    res.status(201).json(project);
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// PUT /api/tutorials/:id/steps — update steps (user edits before video generation)
router.put('/:id/steps', auth, async (req, res) => {
  try {
    const { steps } = req.body;
    if (!steps?.length) return res.status(400).json({ error: 'Steps are required' });

    const project = await Project.findOne({ _id: req.params.id, user: req.user.id });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    project.tutorial.steps = steps;
    await project.save();
    res.json(project);
  } catch (err) {
    console.error('Update steps error:', err);
    res.status(500).json({ error: 'Failed to update steps' });
  }
});

// PUT /api/tutorials/:id/pick-image — user picks a different candidate image for a step
router.put('/:id/pick-image', auth, async (req, res) => {
  try {
    const { stepIndex, candidateFile } = req.body;
    if (typeof stepIndex !== 'number' || stepIndex < 0) return res.status(400).json({ error: 'Invalid step index' });

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

    fs.copyFileSync(path.join(imgDir, candidateFile), path.join(imgDir, mainFile));
    step.screenshot = mainFile;
    step.picked = step.candidates.indexOf(candidateFile);
    await project.save();

    res.json({ ok: true, step: step.step, screenshot: mainFile, picked: step.picked });
  } catch (err) {
    console.error('Pick image error:', err);
    res.status(500).json({ error: 'Failed to update image' });
  }
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
- Be SHORT and concise. Maximum 2-4 sentences per answer. Use bullet points for lists. Never write walls of text.
- When referencing a step from the tutorial, use this exact format: [step:N] where N is the step number. Example: "Check [step:3] for details on deployment." The UI will render these as clickable links.
- If the user asks about a specific step (e.g. "explain step 3", "tell me about chapter 2"), give a focused explanation of that step and use [step:N] to link to it.
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
      max_tokens: 400,
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
  try {
    const project = await Project.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ message: 'Project deleted' });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

module.exports = router;
