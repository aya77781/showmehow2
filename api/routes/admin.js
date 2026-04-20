const express = require('express');
const router = express.Router();
const requireAdmin = require('../middleware/admin');
const supabase = require('../config/supabase');

// GET /api/admin/users — list all users with plan + generated video count
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { data: usersRows, error: uErr } = await supabase
      .from('users')
      .select('id, name, email, picture, plan, credits, plan_expires_at, stripe_customer_id, created_at')
      .order('created_at', { ascending: false });
    if (uErr) throw uErr;

    const { data: projectsRows, error: pErr } = await supabase
      .from('projects')
      .select('user_id, status');
    if (pErr) throw pErr;

    const totals = new Map();
    const completed = new Map();
    for (const p of projectsRows || []) {
      totals.set(p.user_id, (totals.get(p.user_id) || 0) + 1);
      if (p.status === 'complete') {
        completed.set(p.user_id, (completed.get(p.user_id) || 0) + 1);
      }
    }

    const items = (usersRows || []).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      picture: u.picture,
      plan: u.plan,
      credits: u.credits,
      planExpiresAt: u.plan_expires_at,
      hasStripe: !!u.stripe_customer_id,
      videosTotal: totals.get(u.id) || 0,
      videosCompleted: completed.get(u.id) || 0,
      createdAt: u.created_at,
    }));

    res.json({ total: items.length, users: items });
  } catch (err) {
    console.error('[Admin] list users error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
