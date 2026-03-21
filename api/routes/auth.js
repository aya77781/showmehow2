const express = require('express');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();
const API_URL = process.env.API_URL || `http://localhost:${process.env.PORT || 5001}`;
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${API_URL}/api/auth/google/callback`
);

function generateToken(user) {
  return jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    const user = await User.create({ name, email, password });
    const token = generateToken(user);

    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/google — redirect to Google consent screen
router.get('/google', (req, res) => {
  const url = googleClient.generateAuthUrl({
    access_type: 'offline',
    scope: ['profile', 'email'],
    prompt: 'consent',
  });
  res.json({ url });
});

// GET /api/auth/google/callback — exchange code for user
router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.redirect(`${process.env.CLIENT_URL}/login?error=no_code`);
    }

    const { tokens } = await googleClient.getToken(code);
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const { sub: googleId, name, email, picture } = ticket.getPayload();

    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (user) {
      if (!user.googleId) user.googleId = googleId;
      if (picture) user.picture = picture;
      await user.save();
    } else {
      user = await User.create({ name, email, googleId, picture });
    }

    const token = generateToken(user);
    const userData = encodeURIComponent(JSON.stringify({ name, email, picture }));
    res.redirect(`${process.env.CLIENT_URL}/auth/google/callback?token=${token}&user=${userData}`);
  } catch (err) {
    res.redirect(`${process.env.CLIENT_URL}/login?error=google_failed`);
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
