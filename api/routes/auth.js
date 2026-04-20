const express = require('express');
const users = require('../db/users');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/auth/check-email?email=... — true if an account already exists in Supabase Auth.
// Used by the register form for real-time availability hints.
router.get('/check-email', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json({ exists: false, valid: false });
    }
    const existing = await users.findByEmail(email);
    res.json({ exists: !!existing, valid: true });
  } catch (err) {
    console.error('[Auth] check-email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me — current user profile (from public.users).
router.get('/me', auth, async (req, res) => {
  try {
    const user = await users.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('[Auth] /me error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
