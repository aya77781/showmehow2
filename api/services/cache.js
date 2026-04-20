const crypto = require('crypto');
const cacheDb = require('../db/cache');
const imageLibrary = require('../db/imageLibrary');

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

  const noise = new Set(['screenshot', 'interface', 'ui', 'page', 'screen', '2024', '2025', '2026', 'the', 'and', 'for', 'with']);
  const meaningful = words.filter(w => !noise.has(w));

  const site = meaningful[0] || '';
  const tags = [...new Set(meaningful)];
  const rest = meaningful.slice(1).join(' ');

  return { site, tags, page: rest, element: '' };
}

// ═══════════════════════════════════════════════════════════════
// Cache layer (TTL-based, Supabase)
// ═══════════════════════════════════════════════════════════════

async function cacheGet(type, key) {
  try {
    const entry = await cacheDb.get(type, key);
    if (!entry) return null;
    console.log(`[cache] HIT ${type}:${key.slice(0, 40)} (${entry.hits} hits)`);
    return entry;
  } catch {
    return null;
  }
}

async function cacheSet(type, key, value, buffer, ttlDays) {
  try {
    await cacheDb.set(type, key, value, buffer, ttlDays);
    console.log(`[cache] SET ${type}:${key.slice(0, 40)} (TTL ${ttlDays}d)`);
  } catch (err) {
    console.warn(`[cache] SET failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Image Library — persistent semantic image store (Supabase)
// ═══════════════════════════════════════════════════════════════

async function saveImage(buf, query, metadata = {}) {
  try {
    const hash = hashBuffer(buf);
    const parsed = parseImageQuery(query);
    const mime = buf[0] === 0x89 ? 'image/png' : 'image/jpeg';

    const existing = await imageLibrary.findByHash(hash);
    if (existing) {
      const merged = [...new Set([...(existing.tags || []), ...parsed.tags, ...(metadata.tags || [])])];
      const updated = await imageLibrary.update(existing.id, {
        tags: merged,
        uses: (existing.uses || 0) + 1,
        last_used: new Date().toISOString(),
        ...(metadata.annotationData ? { annotation_data: metadata.annotationData } : {}),
      });
      console.log(`[imglib] UPDATE ${hash.slice(0, 12)} (${updated.uses} uses, ${merged.length} tags)`);
      return updated;
    }

    const doc = await imageLibrary.create({
      hash,
      buffer: buf,
      mime,
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

    const tagMatches = await imageLibrary.findBySiteAndTags(parsed.site, parsed.tags, limit * 3);
    if (tagMatches.length === 0) return [];

    const ranked = tagMatches.map(img => {
      const overlap = (img.tags || []).filter(t => parsed.tags.includes(t)).length;
      const score = overlap / Math.max(parsed.tags.length, 1);
      return { ...img, score };
    });

    ranked.sort((a, b) => b.score - a.score);

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

async function markUsed(hash) {
  try {
    await imageLibrary.incrementUses(hash);
  } catch { /* ignore */ }
}

module.exports = { normalize, hashKey, hashBuffer, cacheGet, cacheSet, parseImageQuery, saveImage, findImages, markUsed };
