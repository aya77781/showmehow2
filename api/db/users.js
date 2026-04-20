const supabase = require('../config/supabase');

const UNLIMITED_EMAILS = new Set([
  'ayaboudhas7@gmail.com',
]);

function hasUnlimitedAccess(user) {
  if (!user) return false;
  return UNLIMITED_EMAILS.has((user.email || '').toLowerCase());
}

async function findById(id) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', String(email).toLowerCase().trim())
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function update(id, patch) {
  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function incrementCredits(id, delta) {
  const user = await findById(id);
  if (!user) return null;
  return update(id, { credits: (user.credits || 0) + delta });
}

module.exports = {
  findById,
  findByEmail,
  update,
  incrementCredits,
  hasUnlimitedAccess,
};
