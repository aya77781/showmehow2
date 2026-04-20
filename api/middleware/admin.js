const auth = require('./auth');
const users = require('../db/users');

module.exports = function requireAdmin(req, res, next) {
  auth(req, res, async () => {
    try {
      const user = await users.findById(req.user.id);
      if (user?.is_admin) {
        req.user.email = user.email;
        return next();
      }
      return res.status(403).json({ error: 'Admin access required' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};
