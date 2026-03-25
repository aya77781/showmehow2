const crypto = require('crypto');
const Cache = require('../models/Cache');
const ImageLibrary = require('../models/ImageLibrary');

function normalize(text) {
  return (text || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '');
}

function hashKey(...parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Extract semantic metadata from an imageQuery like "GitHub new repository page name input screenshot 2025"
function parseImageQuery(query) {
  const normalized = normalize(query);
  const words = normalized.split(' ').filter(w => w.length > 1);

  // Remove noise words
  const noise = new Set(['screenshot', 'interface', 'ui', 'page', 'screen', '2024', '2025', '2026', 'the', 'and', 'for', 'with']);
  const meaningful = words.filter(w => !noise.has(w));

  // First word is usually the site name
  const site = meaningful[0] || '';
  const tags = [...new Set(meaningful)];

  // Try to extract page and element from the rest
  const rest = meaningful.slice(1).join(' ');

  return { site, tags, page: rest, element: '' };
}

// ═══════════════════════════════════════════════════════════════
// Cache layer (TTL-based, MongoDB)
// ═══════════════════════════════════════════════════════════════

async function cacheGet(type, key) {
  try {
    const entry = await Cache.findOneAndUpdate(
      { type, key },
      { $inc: { hits: 1 } },
      { returnDocument: 'after' },
    );
    if (!entry) return null;
    console.log(`[cache] HIT ${type}:${key.slice(0, 40)} (${entry.hits} hits)`);
    return entry;
  } catch {
    return null;
  }
}

async function cacheSet(type, key, value, buffer, ttlDays) {
  try {
    const expiresAt = new Date(Date.now() + ttlDays * 86400000);
    await Cache.findOneAndUpdate(
      { type, key },
      { type, key, value, buffer, expiresAt, hits: 0 },
      { upsert: true },
    );
    console.log(`[cache] SET ${type}:${key.slice(0, 40)} (TTL ${ttlDays}d)`);
  } catch (err) {
    console.warn(`[cache] SET failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Image Library — persistent semantic image store
// ═══════════════════════════════════════════════════════════════

async function saveImage(buf, query, metadata = {}) {
  try {
    const hash = hashBuffer(buf);
    const parsed = parseImageQuery(query);

    const existing = await ImageLibrary.findOne({ hash });
    if (existing) {
      // Merge new tags, bump usage
      const merged = [...new Set([...existing.tags, ...parsed.tags, ...(metadata.tags || [])])];
      existing.tags = merged;
      existing.uses += 1;
      existing.lastUsed = new Date();
      if (metadata.annotationData) existing.annotationData = metadata.annotationData;
      await existing.save();
      console.log(`[imglib] UPDATE ${hash.slice(0, 12)} (${existing.uses} uses, ${merged.length} tags)`);
      return existing;
    }

    const doc = await ImageLibrary.create({
      hash,
      buffer: buf,
      mime: buf[0] === 0x89 ? 'image/png' : 'image/jpeg',
      width: metadata.width || null,
      height: metadata.height || null,
      site: parsed.site,
      page: parsed.page,
      element: metadata.element || '',
      tags: [...new Set([...parsed.tags, ...(metadata.tags || [])])],
      originalQuery: query,
      validated: metadata.validated !== false,
      annotationData: metadata.annotationData || null,
    });
    console.log(`[imglib] SAVE ${hash.slice(0, 12)} site=${parsed.site} tags=[${parsed.tags.join(',')}]`);
    return doc;
  } catch (err) {
    console.warn(`[imglib] SAVE failed: ${err.message}`);
    return null;
  }
}

async function findImages(query, limit = 5) {
  try {
    const parsed = parseImageQuery(query);
    if (!parsed.site) return [];

    // Strategy 1: Same site + overlapping tags (best match)
    const tagMatches = await ImageLibrary.find({
      site: parsed.site,
      validated: true,
      tags: { $in: parsed.tags },
    })
      .sort({ uses: -1, lastUsed: -1 })
      .limit(limit * 3) // fetch more, then rank
      .lean();

    if (tagMatches.length === 0) return [];

    // Rank by tag overlap count
    const ranked = tagMatches.map(img => {
      const overlap = img.tags.filter(t => parsed.tags.includes(t)).length;
      const score = overlap / Math.max(parsed.tags.length, 1);
      return { ...img, score };
    });

    ranked.sort((a, b) => b.score - a.score);

    // Only return images with >= 40% tag overlap
    const good = ranked.filter(r => r.score >= 0.4).slice(0, limit);

    if (good.length > 0) {
      console.log(`[imglib] FIND "${parsed.site}" → ${good.length} matches (best score: ${good[0].score.toFixed(2)})`);
    }

    return good;
  } catch (err) {
    console.warn(`[imglib] FIND failed: ${err.message}`);
    return [];
  }
}

// Bump usage stats when an image is actually used
async function markUsed(hash) {
  try {
    await ImageLibrary.updateOne({ hash }, { $inc: { uses: 1 }, $set: { lastUsed: new Date() } });
  } catch { /* ignore */ }
}

module.exports = { normalize, hashKey, hashBuffer, cacheGet, cacheSet, parseImageQuery, saveImage, findImages, markUsed };
