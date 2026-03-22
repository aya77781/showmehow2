const express = require('express');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();
const API_URL = process.env.API_URL || `http://localhost:${process.env.PORT || 5001}`;
const REDIRECT_URI = `${API_URL}/api/auth/google/callback`;

console.log('[Auth] Google OAuth config:', {
  clientId: process.env.GOOGLE_CLIENT_ID ? `${process.env.GOOGLE_CLIENT_ID.slice(0, 20)}...` : 'MISSING',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ? '✓ set' : '✗ MISSING',
  redirectUri: REDIRECT_URI,
  clientUrl: process.env.CLIENT_URL || 'MISSING',
  apiUrl: API_URL,
});

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
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
    console.log(`[Auth] Register attempt: ${email}`);

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      console.log(`[Auth] Register failed: email ${email} already exists`);
      return res.status(400).json({ error: 'Email is already registered' });
    }

    const user = await User.create({ name, email, password });
    const token = generateToken(user);
    console.log(`[Auth] Register success: ${email} (${user._id})`);

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('[Auth] Register error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log(`[Auth] Login attempt: ${email}`);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.password) {
      console.log(`[Auth] Login failed: user not found or no password — ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      console.log(`[Auth] Login failed: wrong password — ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    console.log(`[Auth] Login success: ${email} (${user._id})`);
    res.json({ token, user });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
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
  console.log(`[Auth] Google OAuth → redirecting to consent screen`);
  console.log(`[Auth] Google OAuth redirect_uri: ${REDIRECT_URI}`);
  res.json({ url });
});

// GET /api/auth/google/callback — exchange code for user
router.get('/google/callback', async (req, res) => {
  console.log(`[Auth] Google callback received — code: ${req.query.code ? 'yes (' + req.query.code.slice(0, 20) + '...)' : 'NO CODE'}`);
  console.log(`[Auth] Google callback — error param: ${req.query.error || 'none'}`);

  try {
    const { code } = req.query;
    if (!code) {
      console.error('[Auth] Google callback — no code in query');
      return res.redirect(`${process.env.CLIENT_URL}/login?error=no_code`);
    }

    // Step 1: Exchange code for tokens
    console.log('[Auth] Step 1: Exchanging code for tokens...');
    const { tokens } = await googleClient.getToken(code);
    console.log(`[Auth] Step 1 done: got tokens — id_token: ${tokens.id_token ? 'yes' : 'NO'}, access_token: ${tokens.access_token ? 'yes' : 'NO'}`);

    // Step 2: Verify ID token
    console.log('[Auth] Step 2: Verifying ID token...');
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { sub: googleId, name, email, picture } = ticket.getPayload();
    console.log(`[Auth] Step 2 done: verified — ${email} (googleId: ${googleId})`);

    // Step 3: Find or create user
    console.log('[Auth] Step 3: Finding/creating user in DB...');
    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (user) {
      if (!user.googleId) user.googleId = googleId;
      if (picture) user.picture = picture;
      await user.save();
      console.log(`[Auth] Step 3 done: existing user updated — ${email} (${user._id})`);
    } else {
      user = await User.create({ name, email, googleId, picture });
      console.log(`[Auth] Step 3 done: new user created — ${email} (${user._id})`);
    }

    // Step 4: Generate JWT and redirect
    const token = generateToken(user);
    const userData = encodeURIComponent(JSON.stringify({ name, email, picture }));
    const redirectUrl = `${process.env.CLIENT_URL}/auth/google/callback?token=${token}&user=${userData}`;
    console.log(`[Auth] Step 4: Redirecting to ${process.env.CLIENT_URL}/auth/google/callback`);
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('[Auth] Google OAuth FAILED at callback:');
    console.error('[Auth]   Error message:', err.message);
    console.error('[Auth]   Error code:', err.code || 'none');
    console.error('[Auth]   Response data:', JSON.stringify(err.response?.data || 'none'));
    console.error('[Auth]   Stack:', err.stack?.split('\n').slice(0, 3).join('\n'));
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
    console.error('[Auth] /me error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
