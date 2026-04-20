const supabase = require('../config/supabase');

// Verifies a Supabase access token (JWT) and attaches { id, email } to req.user.
module.exports = async function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token required' });
  }
  const token = header.slice(7);

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = { id: data.user.id, email: data.user.email };
    next();
  } catch (err) {
    console.error('[Auth] middleware error:', err.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
};
