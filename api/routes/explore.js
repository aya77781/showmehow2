const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const auth = require('../middleware/auth');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CATEGORIES = [
  { id: 'dev', label: 'Development', icon: 'code' },
  { id: 'design', label: 'Design', icon: 'palette' },
  { id: 'marketing', label: 'Marketing', icon: 'megaphone' },
  { id: 'productivity', label: 'Productivity', icon: 'zap' },
  { id: 'data', label: 'Data & AI', icon: 'database' },
  { id: 'devops', label: 'DevOps', icon: 'server' },
  { id: 'other', label: 'Other', icon: 'grid' },
];

// GET /api/explore — list public tutorials (no auth)
router.get('/', async (req, res) => {
  try {
    const { category, search, sort, page = 1, limit = 20 } = req.query;

    const filter = { isPublic: true, status: 'complete' };
    if (category && category !== 'all') filter.category = category;
    if (search) {
      const safe = escapeRegex(String(search));
      filter.$or = [
        { topic: { $regex: safe, $options: 'i' } },
        { 'tutorial.title': { $regex: safe, $options: 'i' } },
        { tags: { $regex: safe, $options: 'i' } },
      ];
    }

    const sortBy = sort === 'popular' ? { views: -1 } : sort === 'likes' ? { likes: -1 } : { createdAt: -1 };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [tutorials, total] = await Promise.all([
      Project.find(filter)
        .select('topic slug category tags views likes tutorial.title tutorial.steps sessionId createdAt')
        .populate('user', 'name picture')
        .sort(sortBy)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Project.countDocuments(filter),
    ]);

    const items = tutorials.map(t => ({
      slug: t.slug,
      topic: t.topic,
      title: t.tutorial?.title || t.topic,
      category: t.category,
      tags: t.tags || [],
      steps: t.tutorial?.steps?.length || 0,
      views: t.views || 0,
      likes: t.likes || 0,
      sessionId: t.sessionId,
      thumbnail: t.sessionId && t.tutorial?.steps?.[0]?.screenshot
        ? `/output/sessions/${t.sessionId}/images/${t.tutorial.steps[0].screenshot}`
        : null,
      author: { name: t.user?.name, picture: t.user?.picture },
      createdAt: t.createdAt,
    }));

    res.json({ items, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)), categories: CATEGORIES });
  } catch (err) {
    console.error('Explore list error:', err);
    res.status(500).json({ error: 'Failed to load tutorials' });
  }
});

// GET /api/explore/categories — list categories
router.get('/categories', (req, res) => {
  res.json(CATEGORIES);
});

// GET /api/explore/:slug — single public tutorial (no auth)
router.get('/:slug', async (req, res) => {
  try {
    const project = await Project.findOneAndUpdate(
      { slug: req.params.slug, isPublic: true, status: 'complete' },
      { $inc: { views: 1 } },
      { new: true }
    ).populate('user', 'name picture').lean();

    if (!project) return res.status(404).json({ error: 'Tutorial not found' });

    res.json({
      slug: project.slug,
      topic: project.topic,
      title: project.tutorial?.title || project.topic,
      url: project.tutorial?.url,
      category: project.category,
      tags: project.tags || [],
      steps: (project.tutorial?.steps || []).map(s => ({
        step: s.step, title: s.title, description: s.description,
        screenshot: s.screenshot, video: s.video,
      })),
      sessionId: project.sessionId,
      views: project.views,
      likes: project.likes,
      author: { name: project.user?.name, picture: project.user?.picture },
      createdAt: project.createdAt,
    });
  } catch (err) {
    console.error('Explore slug error:', err);
    res.status(500).json({ error: 'Failed to load tutorial' });
  }
});

// POST /api/explore/:slug/like — like a tutorial (no auth, simple increment)
router.post('/:slug/like', async (req, res) => {
  try {
    const project = await Project.findOneAndUpdate(
      { slug: req.params.slug, isPublic: true },
      { $inc: { likes: 1 } },
      { new: true }
    );
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json({ likes: project.likes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to like' });
  }
});

// PUT /api/explore/:id/visibility — toggle public/private (auth required)
router.put('/:id/visibility', auth, async (req, res) => {
  try {
    const { isPublic, category, tags } = req.body;
    const validCategories = CATEGORIES.map(c => c.id);
    const project = await Project.findOne({ _id: req.params.id, user: req.user.id });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.status !== 'complete') return res.status(400).json({ error: 'Only completed tutorials can be published' });

    project.isPublic = !!isPublic;
    if (category && validCategories.includes(category)) project.category = category;
    if (Array.isArray(tags)) project.tags = tags.slice(0, 10).map(t => String(t).trim()).filter(Boolean);
    await project.save();

    res.json({ isPublic: project.isPublic, slug: project.slug, category: project.category });
  } catch (err) {
    console.error('Visibility update error:', err);
    res.status(500).json({ error: 'Failed to update visibility' });
  }
});

module.exports = router;
