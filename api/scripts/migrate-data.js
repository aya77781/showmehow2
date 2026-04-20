/*
 * One-shot migration: MongoDB → Supabase
 *
 * Prereqs:
 *   - MongoDB must be reachable via MONGO_URI (default mongodb://localhost:27017/hackatonapp)
 *   - SUPABASE_URL + SUPABASE_SERVICE_KEY must be set in .env
 *   - Buckets "cache-files" and "image-library" must already exist
 *
 * Usage:
 *   node scripts/migrate-data.js
 *   node scripts/migrate-data.js --dry-run      (no writes, just counts)
 *   node scripts/migrate-data.js --only=users   (users | projects | cache | images)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const supabase = require('../config/supabase');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/hackatonapp';
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY = (process.argv.find((a) => a.startsWith('--only='))?.split('=')[1] || '').split(',').filter(Boolean);
const shouldRun = (step) => ONLY.length === 0 || ONLY.includes(step);

function slugify(topic, id) {
  const base = (topic || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 70);
  const prefix = base.startsWith('how-to') ? '' : 'video-tutorial-';
  return prefix + base + '-' + String(id).slice(-6);
}

function mongoBufferToBuffer(field) {
  if (!field) return null;
  if (Buffer.isBuffer(field)) return field;
  if (field.buffer && Buffer.isBuffer(field.buffer)) return Buffer.from(field.buffer);
  if (field._bsontype === 'Binary' && field.buffer) return Buffer.from(field.buffer);
  try { return Buffer.from(field); } catch { return null; }
}

async function migrateUsers(db) {
  const col = db.collection('users');
  const docs = await col.find({}).toArray();
  console.log(`\n[users] Found ${docs.length} documents`);

  const idMap = new Map();
  let ok = 0, fail = 0;

  for (const d of docs) {
    const newId = crypto.randomUUID();
    idMap.set(d._id.toString(), newId);

    const payload = {
      id: newId,
      name: d.name || d.email || 'Unknown',
      email: (d.email || '').toLowerCase().trim(),
      picture: d.picture || null,
      google_id: d.googleId || null,
      password: d.password || null,
      stripe_customer_id: d.stripeCustomerId || null,
      plan: d.plan || 'free',
      credits: typeof d.credits === 'number' ? d.credits : 10,
      stripe_subscription_id: d.stripeSubscriptionId || null,
      plan_expires_at: d.planExpiresAt ? new Date(d.planExpiresAt).toISOString() : null,
      created_at: d.createdAt ? new Date(d.createdAt).toISOString() : undefined,
    };

    if (DRY_RUN) { ok++; continue; }

    const { error } = await supabase.from('users').upsert(payload, { onConflict: 'email' });
    if (error) {
      console.warn(`  ✗ ${payload.email}: ${error.message}`);
      fail++;
      // refetch existing id so we can map projects
      const { data } = await supabase.from('users').select('id').eq('email', payload.email).maybeSingle();
      if (data) idMap.set(d._id.toString(), data.id);
    } else {
      ok++;
    }
  }

  console.log(`[users] ✓ ${ok} inserted/updated, ✗ ${fail} failed`);
  return idMap;
}

async function migrateProjects(db, userIdMap) {
  const col = db.collection('projects');
  const docs = await col.find({}).toArray();
  console.log(`\n[projects] Found ${docs.length} documents`);

  const idMap = new Map();
  let ok = 0, fail = 0, stepsOk = 0;

  for (const d of docs) {
    const newId = crypto.randomUUID();
    idMap.set(d._id.toString(), newId);

    const userId = userIdMap.get(d.user?.toString());
    if (!userId) {
      console.warn(`  ✗ project ${d._id}: user ${d.user} not found in map — skipping`);
      fail++;
      continue;
    }

    const tutorial = d.tutorial || {};
    const payload = {
      id: newId,
      user_id: userId,
      topic: d.topic || 'Untitled',
      source: d.source || 'auto',
      status: d.status || 'draft',
      tutorial_title: tutorial.title || null,
      tutorial_url: tutorial.url || null,
      tutorial_source: tutorial.source || null,
      tutorial_wiki_url: tutorial.wikiUrl || null,
      session_id: d.sessionId || null,
      stats: d.stats || null,
      error: d.error || null,
      is_public: typeof d.isPublic === 'boolean' ? d.isPublic : true,
      slug: d.slug || slugify(d.topic, newId),
      category: d.category || 'other',
      tags: d.tags || [],
      views: d.views || 0,
      likes: d.likes || 0,
      created_at: d.createdAt ? new Date(d.createdAt).toISOString() : undefined,
    };

    if (DRY_RUN) { ok++; continue; }

    const { error } = await supabase.from('projects').upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn(`  ✗ project "${payload.topic}": ${error.message}`);
      fail++;
      continue;
    }
    ok++;

    // Steps
    const steps = Array.isArray(tutorial.steps) ? tutorial.steps : [];
    if (steps.length > 0) {
      await supabase.from('project_steps').delete().eq('project_id', newId);
      const rows = steps.map((s, i) => ({
        project_id: newId,
        step: typeof s.step === 'number' ? s.step : i + 1,
        title: s.title || null,
        description: s.description || null,
        screenshot: s.screenshot || null,
        image_url: s.imageUrl || null,
        video: s.video || null,
        video_size: s.videoSize || null,
        candidates: s.candidates || null,
        valid_candidates: s.validCandidates || null,
        picked: typeof s.picked === 'number' ? s.picked : null,
        annotated: typeof s.annotated === 'boolean' ? s.annotated : null,
        highlight_label: s.highlightLabel || null,
      }));
      const { error: sErr } = await supabase.from('project_steps').insert(rows);
      if (sErr) console.warn(`  ✗ steps for "${payload.topic}": ${sErr.message}`);
      else stepsOk += rows.length;
    }
  }

  console.log(`[projects] ✓ ${ok} projects, ${stepsOk} steps, ✗ ${fail} failed`);
  return idMap;
}

async function migrateCache(db) {
  const col = db.collection('caches');
  const docs = await col.find({}).toArray();
  console.log(`\n[cache] Found ${docs.length} documents`);

  let ok = 0, fail = 0, uploaded = 0;

  for (const d of docs) {
    const path = `${d.type}/${d.key}`;
    let buffer_path = null;

    const buf = mongoBufferToBuffer(d.buffer);
    if (buf && !DRY_RUN) {
      const { error: upErr } = await supabase.storage
        .from('cache-files')
        .upload(path, buf, { upsert: true, contentType: 'application/octet-stream' });
      if (upErr) console.warn(`  ⚠ storage upload failed ${path}: ${upErr.message}`);
      else { buffer_path = path; uploaded++; }
    }

    const payload = {
      type: d.type,
      key: d.key,
      value: d.value ?? null,
      buffer_path,
      hits: d.hits || 0,
      expires_at: d.expiresAt ? new Date(d.expiresAt).toISOString() : null,
      created_at: d.createdAt ? new Date(d.createdAt).toISOString() : undefined,
    };

    if (DRY_RUN) { ok++; continue; }

    const { error } = await supabase.from('cache').upsert(payload, { onConflict: 'type,key' });
    if (error) { console.warn(`  ✗ cache ${d.type}:${d.key?.slice?.(0, 30)}: ${error.message}`); fail++; }
    else ok++;
  }

  console.log(`[cache] ✓ ${ok} inserted, ${uploaded} buffers uploaded, ✗ ${fail} failed`);
}

async function migrateImageLibrary(db) {
  const col = db.collection('imagelibraries');
  const docs = await col.find({}).toArray();
  console.log(`\n[image_library] Found ${docs.length} documents`);

  let ok = 0, fail = 0;

  for (const d of docs) {
    const mime = d.mime || 'image/jpeg';
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    const path = `${d.hash.slice(0, 2)}/${d.hash}.${ext}`;

    const buf = mongoBufferToBuffer(d.buffer);
    if (buf && !DRY_RUN) {
      const { error: upErr } = await supabase.storage
        .from('image-library')
        .upload(path, buf, { upsert: true, contentType: mime });
      if (upErr && !String(upErr.message).includes('already exists')) {
        console.warn(`  ⚠ upload failed ${path}: ${upErr.message}`);
      }
    }

    const payload = {
      hash: d.hash,
      storage_path: path,
      mime,
      width: d.width || null,
      height: d.height || null,
      site: d.site || null,
      page: d.page || null,
      element: d.element || null,
      tags: d.tags || [],
      original_query: d.originalQuery || null,
      validated: typeof d.validated === 'boolean' ? d.validated : true,
      annotation_data: d.annotationData || null,
      uses: d.uses || 1,
      last_used: d.lastUsed ? new Date(d.lastUsed).toISOString() : new Date().toISOString(),
      created_at: d.createdAt ? new Date(d.createdAt).toISOString() : undefined,
    };

    if (DRY_RUN) { ok++; continue; }

    const { error } = await supabase.from('image_library').upsert(payload, { onConflict: 'hash' });
    if (error) { console.warn(`  ✗ image ${d.hash.slice(0, 8)}: ${error.message}`); fail++; }
    else ok++;
  }

  console.log(`[image_library] ✓ ${ok} inserted, ✗ ${fail} failed`);
}

async function main() {
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Migration Mongo → Supabase`);
  console.log(`  Mongo:    ${MONGO_URI}`);
  console.log(`  Supabase: ${process.env.SUPABASE_URL}`);
  if (ONLY.length) console.log(`  Only:     ${ONLY.join(', ')}`);

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');
  const db = mongoose.connection.db;

  let userIdMap = new Map();

  if (shouldRun('users')) {
    userIdMap = await migrateUsers(db);
  } else {
    const { data } = await supabase.from('users').select('id, email');
    for (const u of data || []) {
      // Try reverse lookup by email if projects need it
      const mongoUsers = await db.collection('users').find({ email: u.email }).toArray();
      for (const mu of mongoUsers) userIdMap.set(mu._id.toString(), u.id);
    }
    console.log(`[users] Skipped — loaded ${userIdMap.size} existing users for mapping`);
  }

  if (shouldRun('projects')) await migrateProjects(db, userIdMap);
  if (shouldRun('cache'))    await migrateCache(db);
  if (shouldRun('images'))   await migrateImageLibrary(db);

  await mongoose.disconnect();
  console.log('\n✓ Migration done');
}

main().catch((err) => {
  console.error('\n✗ Migration failed:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});
