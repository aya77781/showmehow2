const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const projects = require('../db/projects');
const users = require('../db/users');
const auth = require('../middleware/auth');

function findThumbnail(sessionId, screenshot) {
  if (!sessionId) return null;
  const imgDir = path.resolve(__dirname, '..', 'output', 'sessions', sessionId, 'images');
  if (screenshot && fs.existsSync(path.join(imgDir, screenshot))) {
    return `/output/sessions/${sessionId}/images/${screenshot}`;
  }
  for (const ext of ['png', 'jpg', 'jpeg']) {
    const file = `step-01.${ext}`;
    if (fs.existsSync(path.join(imgDir, file))) {
      return `/output/sessions/${sessionId}/images/${file}`;
    }
  }
  return null;
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
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    const { items: tutorials, total } = await projects.listPublic({
      category,
      search,
      sort,
      page: pageNum,
      limit: limitNum,
    });

    const items = tutorials.map(t => ({
      slug: t.slug,
      topic: t.topic,
      title: t.tutorial?.title || t.topic,
      category: t.category,
      tags: t.tags || [],
      steps: t.tutorial?.steps?.length || 0,
      views: t.views || 0,
      likes: t.likes || 0,
      sessionId: t.session_id,
      thumbnail: findThumbnail(t.session_id, t.tutorial?.steps?.[0]?.screenshot),
      author: { name: t.user?.name, picture: t.user?.picture },
      createdAt: t.created_at,
    }));

    res.json({
      items,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      categories: CATEGORIES,
    });
  } catch (err) {
    console.error('Explore list error:', err);
    res.status(500).json({ error: 'Failed to load tutorials' });
  }
});

// GET /api/explore/categories
router.get('/categories', (req, res) => {
  res.json(CATEGORIES);
});

// GET /api/explore/:slug
router.get('/:slug', async (req, res) => {
  try {
    await projects.incrementViews(req.params.slug);
    const project = await projects.findBySlug(req.params.slug);

    if (!project || !project.is_public || project.status !== 'complete') {
      return res.status(404).json({ error: 'Tutorial not found' });
    }

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
      sessionId: project.session_id,
      views: project.views,
      likes: project.likes,
      author: { name: project.user?.name, picture: project.user?.picture },
      createdAt: project.created_at,
    });
  } catch (err) {
    console.error('Explore slug error:', err);
    res.status(500).json({ error: 'Failed to load tutorial' });
  }
});

// POST /api/explore/:slug/like
router.post('/:slug/like', async (req, res) => {
  try {
    const likes = await projects.incrementLikes(req.params.slug);
    if (likes === null) return res.status(404).json({ error: 'Not found' });
    res.json({ likes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to like' });
  }
});

// PUT /api/explore/:id/visibility
router.put('/:id/visibility', auth, async (req, res) => {
  try {
    const { isPublic, category, tags } = req.body;
    const validCategories = CATEGORIES.map(c => c.id);
    const project = await projects.findByIdForUser(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.status !== 'complete') return res.status(400).json({ error: 'Only completed tutorials can be published' });

    if (!isPublic) {
      const user = await users.findById(req.user.id);
      const isPaid = users.hasUnlimitedAccess(user) || (user.plan && user.plan !== 'free');
      if (!isPaid) {
        return res.status(403).json({ error: 'Upgrade to a paid plan to make videos private. Free videos are always public for SEO.' });
      }
    }

    const patch = { isPublic: !!isPublic };
    if (category && validCategories.includes(category)) patch.category = category;
    if (Array.isArray(tags)) patch.tags = tags.slice(0, 10).map(t => String(t).trim()).filter(Boolean);

    const updated = await projects.updateProject(project.id, patch);

    res.json({ isPublic: updated.is_public, slug: updated.slug, category: updated.category });
  } catch (err) {
    console.error('Visibility update error:', err);
    res.status(500).json({ error: 'Failed to update visibility' });
  }
});

module.exports = router;
