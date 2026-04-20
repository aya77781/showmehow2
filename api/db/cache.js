const supabase = require('../config/supabase');

const BUCKET = 'cache-files';

function bufferPath(type, key) {
  return `${type}/${key}`;
}

async function uploadBuffer(type, key, buffer) {
  const path = bufferPath(type, key);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { upsert: true, contentType: 'application/octet-stream' });
  if (error) throw error;
  return path;
}

async function downloadBuffer(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) return null;
  const arr = await data.arrayBuffer();
  return Buffer.from(arr);
}

async function get(type, key) {
  const { data, error } = await supabase
    .from('cache')
    .select('*')
    .eq('type', type)
    .eq('key', key)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;

  await supabase
    .from('cache')
    .update({ hits: (data.hits || 0) + 1 })
    .eq('id', data.id);

  let buffer = null;
  if (data.buffer_path) {
    buffer = await downloadBuffer(data.buffer_path);
  }
  return { ...data, hits: (data.hits || 0) + 1, buffer };
}

async function set(type, key, value, buffer, ttlDays) {
  const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();
  let buffer_path = null;
  if (buffer) {
    try {
      buffer_path = await uploadBuffer(type, key, buffer);
    } catch (err) {
      console.warn('[cache] storage upload failed:', err.message);
    }
  }

  const payload = {
    type,
    key,
    value: value ?? null,
    buffer_path,
    expires_at: expiresAt,
    hits: 0,
  };

  const { error } = await supabase
    .from('cache')
    .upsert(payload, { onConflict: 'type,key' });
  if (error) throw error;
}

module.exports = { get, set };
