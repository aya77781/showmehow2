const supabase = require('../config/supabase');

const BUCKET = 'image-library';

function storagePath(hash, mime) {
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  return `${hash.slice(0, 2)}/${hash}.${ext}`;
}

async function uploadImage(hash, buffer, mime) {
  const path = storagePath(hash, mime);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { upsert: true, contentType: mime });
  if (error && !String(error.message || '').includes('already exists')) throw error;
  return path;
}

async function findByHash(hash) {
  const { data, error } = await supabase
    .from('image_library')
    .select('*')
    .eq('hash', hash)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function create(row) {
  const path = await uploadImage(row.hash, row.buffer, row.mime || 'image/jpeg');
  const insertRow = {
    hash: row.hash,
    storage_path: path,
    mime: row.mime || 'image/jpeg',
    width: row.width || null,
    height: row.height || null,
    site: row.site || null,
    page: row.page || null,
    element: row.element || null,
    tags: row.tags || [],
    original_query: row.originalQuery || null,
    validated: row.validated !== false,
    annotation_data: row.annotationData || null,
    uses: 1,
    last_used: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('image_library')
    .insert(insertRow)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function update(id, patch) {
  const { data, error } = await supabase
    .from('image_library')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function findBySiteAndTags(site, tags, limit = 15) {
  const { data, error } = await supabase
    .from('image_library')
    .select('*')
    .eq('site', site)
    .eq('validated', true)
    .overlaps('tags', tags)
    .order('uses', { ascending: false })
    .order('last_used', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function incrementUses(hash) {
  const { data: current } = await supabase
    .from('image_library')
    .select('id, uses')
    .eq('hash', hash)
    .maybeSingle();
  if (!current) return;
  await supabase
    .from('image_library')
    .update({ uses: (current.uses || 0) + 1, last_used: new Date().toISOString() })
    .eq('id', current.id);
}

module.exports = { findByHash, create, update, findBySiteAndTags, incrementUses };
