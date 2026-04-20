const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalize, hashKey, cacheGet, cacheSet } = require('./cache');

const OUT_DIR = path.resolve(__dirname, '..', 'output', 'sessions');

const axiosInstance = axios.create({
  timeout: 10000,
  maxRedirects: 5,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url, attempt = 1) {
  try {
    const res = await axiosInstance.get(url);
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 && attempt === 1) {
      await sleep(2000);
      return fetchHtml(url, attempt + 1);
    }
    if (attempt < 3 && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || status >= 500)) {
      await sleep(500 * attempt);
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  }
}

function cleanText(s) {
  return (s || '')
    .replace(/\s+/g, ' ')
    .replace(/\[\d+\]/g, '')
    .trim();
}

function absoluteUrl(src, baseUrl) {
  if (!src) return null;
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Discovery layer
// ═══════════════════════════════════════════════════════════════

// WikiHow has a functional native search endpoint — use it directly.
async function searchWikiHow(topic) {
  const url = `https://www.wikihow.com/wikiHowTo?search=${encodeURIComponent(topic)}`;
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const urls = new Set();
    $('a.result_link').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (/wikihow\.com\/[^\s?#]+/.test(href) && !/\/Category:|\/Special:|\/User:/.test(href)) {
        const abs = /^https?:/.test(href) ? href : absoluteUrl(href, 'https://www.wikihow.com');
        if (abs) urls.add(abs.split('?')[0].split('#')[0]);
      }
    });
    return [...urls].slice(0, 3);
  } catch (err) {
    console.warn(`[Scraper Error] wikihow search: ${err.message}`);
    return [];
  }
}

// Serper API proxy for discovering article URLs on sites whose native search
// is JS-rendered or bot-blocked. Returns top 3 organic result URLs.
async function findArticleUrl(topic, site) {
  if (!process.env.SERPER_API_KEY) {
    console.warn('[Scraper] SERPER_API_KEY not set — skipping Serper discovery');
    return [];
  }
  const query = `site:${site} ${topic} tutorial`;
  try {
    const response = await axios.post(
      'https://google.serper.dev/search',
      { q: query, num: 5 },
      {
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    return (response.data.organic || [])
      .map((r) => r.link)
      .filter((l) => typeof l === 'string' && l.includes(site.split('/')[0]))
      .slice(0, 3);
  } catch (err) {
    console.warn(`[Scraper Error] Serper for ${site}: ${err.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// Scrapers
// ═══════════════════════════════════════════════════════════════
function isWikiHowStepImage(src) {
  if (!src) return false;
  // Real step screenshots contain "-Step-N" in the filename
  if (/-Step-\d+/i.test(src)) return true;
  // Reject expert profile crops
  if (/-crop-\d+-\d+-\d+px/i.test(src)) return false;
  return true;
}

async function scrapeWikiHow(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const title = cleanText($('h1#section_0').text() || $('h1.firstHeading').text() || $('h1#title').text() || $('h1').first().text());

  const steps = [];
  // WikiHow real steps: ol.steps_list_2 (or .steps_list) > li. Articles may have multiple
  // method sections; we flatten them into one list and renumber.
  let $items = $('ol.steps_list_2 > li, ol.steps_list > li');
  if ($items.length < 3) $items = $('div.step');

  $items.each((_, el) => {
    const $el = $(el);

    const $clone = $el.clone();
    $clone.find('script, style, .mwimg, .mwimg-half, .mwimg-large, .whimage, img, .expert_box, .expert_byline').remove();
    let text = cleanText($clone.text()).slice(0, 500);
    if (!text || text.length < 10) return;

    // Find first step screenshot (filter out profile/avatar images)
    let imageUrl = null;
    let imageAlt = '';
    $el.find('img').each((__, img) => {
      if (imageUrl) return;
      const src = $(img).attr('data-src') || $(img).attr('data-srcset')?.split(' ')[0] || $(img).attr('src') || null;
      if (isWikiHowStepImage(src)) {
        imageUrl = absoluteUrl(src, url);
        imageAlt = $(img).attr('alt') || '';
      }
    });

    steps.push({
      index: steps.length + 1,
      text,
      imageUrl,
      imageAlt,
    });
  });

  return { source: 'wikihow', title, url, steps };
}

async function scrapeHowToGeek(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const title = cleanText($('h1.article-title').text() || $('h1').first().text());

  const $body = $('article, .article-body, .entry-content, main').first().length
    ? $('article, .article-body, .entry-content, main').first()
    : $('body');

  const steps = [];
  const children = $body.find('h2, h3, p, figure, img').toArray();

  let current = null;
  let paraBuffer = [];
  let pendingImage = null;

  const flush = () => {
    if (current) {
      current.text = cleanText([current.text, ...paraBuffer].filter(Boolean).join(' ')).slice(0, 500);
      if (!current.imageUrl && pendingImage) current.imageUrl = pendingImage;
      if (current.text && current.text.length > 10) steps.push(current);
    }
    paraBuffer = [];
    pendingImage = null;
  };

  for (const el of children) {
    const tag = el.tagName?.toLowerCase();
    const $el = $(el);

    if (tag === 'h2' || tag === 'h3') {
      flush();
      current = {
        index: steps.length + 1,
        text: cleanText($el.text()),
        imageUrl: null,
        imageAlt: '',
      };
    } else if (tag === 'p') {
      if (current) paraBuffer.push(cleanText($el.text()));
    } else if (tag === 'figure' || tag === 'img') {
      const $img = tag === 'img' ? $el : $el.find('img').first();
      const src = $img.attr('data-src') || $img.attr('src') || null;
      const absUrl = src ? absoluteUrl(src, url) : null;
      if (absUrl) {
        if (current && !current.imageUrl) {
          current.imageUrl = absUrl;
          current.imageAlt = $img.attr('alt') || '';
        } else {
          pendingImage = absUrl;
        }
      }
    }
  }
  flush();

  return { source: 'howtogeek', title, url, steps };
}

// Generic heading-based article scraper used for MakeUseOf / DigitalOcean /
// freeCodeCamp — all three sites use h2/h3 headings with paragraph bodies
// and figure/img blocks per step.
function scrapeHeadingBasedArticle($, url, source, bodySelector) {
  const title = cleanText($('h1').first().text());
  const $body = $(bodySelector).first().length ? $(bodySelector).first() : $('body');

  const steps = [];
  let current = null;
  let paraBuffer = [];
  let pendingImage = null;

  const flush = () => {
    if (current) {
      current.text = cleanText([current.text, ...paraBuffer].filter(Boolean).join(' ')).slice(0, 500);
      if (!current.imageUrl && pendingImage) current.imageUrl = pendingImage;
      if (current.text && current.text.length > 10) steps.push(current);
    }
    paraBuffer = [];
    pendingImage = null;
  };

  $body.find('h2, h3, p, figure, img').each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    const $el = $(el);
    if (tag === 'h2' || tag === 'h3') {
      flush();
      current = {
        index: steps.length + 1,
        text: cleanText($el.text()),
        imageUrl: null,
        imageAlt: '',
      };
    } else if (tag === 'p') {
      if (current) paraBuffer.push(cleanText($el.text()));
    } else if (tag === 'figure' || tag === 'img') {
      const $img = tag === 'img' ? $el : $el.find('img').first();
      const src = $img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('src') || null;
      const absUrl = src ? absoluteUrl(src, url) : null;
      if (absUrl) {
        if (current && !current.imageUrl) {
          current.imageUrl = absUrl;
          current.imageAlt = $img.attr('alt') || '';
        } else {
          pendingImage = absUrl;
        }
      }
    }
  });
  flush();

  return { source, title, url, steps };
}

async function scrapeMakeUseOf(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  return scrapeHeadingBasedArticle($, url, 'makeuseof',
    'article, .content-block-regular, .entry-content, .article-body, main');
}

async function scrapeDigitalOcean(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  return scrapeHeadingBasedArticle($, url, 'digitalocean',
    'article, .content, .tutorial-body, main');
}

async function scrapeFreeCodeCamp(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  return scrapeHeadingBasedArticle($, url, 'freecodecamp',
    'article, .post-full-content, .post-content, main');
}

// Lifewire is often Cloudflare-protected — swallow 403s silently and let the
// caller try the next source.
async function scrapeLifewire(url) {
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    return scrapeHeadingBasedArticle($, url, 'lifewire',
      'article, .article-content, .comp-mntl-sc-page, main');
  } catch (err) {
    if (err.response?.status === 403) return null;
    throw err;
  }
}

// GeeksForGeeks — filter out ad/banner/logo/tiny images to avoid noise.
async function scrapeGeeksForGeeks(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const title = cleanText($('h1.entry-title').text() || $('article h1').first().text() || $('h1').first().text());
  const $body = $('.entry-content, article, main').first().length
    ? $('.entry-content, article, main').first()
    : $('body');

  const steps = [];
  let current = null;
  let paraBuffer = [];
  let pendingImage = null;

  const flush = () => {
    if (current) {
      current.text = cleanText([current.text, ...paraBuffer].filter(Boolean).join(' ')).slice(0, 500);
      if (!current.imageUrl && pendingImage) current.imageUrl = pendingImage;
      if (current.text && current.text.length > 10) steps.push(current);
    }
    paraBuffer = [];
    pendingImage = null;
  };

  const isNoiseImage = ($img) => {
    const src = ($img.attr('data-src') || $img.attr('src') || '').toLowerCase();
    if (!src) return true;
    if (/ad[s_-]|banner|logo|icon|sprite/.test(src)) return true;
    const w = parseInt($img.attr('width'), 10);
    const h = parseInt($img.attr('height'), 10);
    if (Number.isFinite(w) && w < 200) return true;
    if (Number.isFinite(h) && h < 200) return true;
    return false;
  };

  $body.find('h2, h3, p, figure, img').each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    const $el = $(el);
    if (tag === 'h2' || tag === 'h3') {
      flush();
      current = { index: steps.length + 1, text: cleanText($el.text()), imageUrl: null, imageAlt: '' };
    } else if (tag === 'p') {
      if (current) paraBuffer.push(cleanText($el.text()));
    } else if (tag === 'figure' || tag === 'img') {
      const $img = tag === 'img' ? $el : $el.find('img').first();
      if (!$img.length || isNoiseImage($img)) return;
      const src = $img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('src') || null;
      const absUrl = src ? absoluteUrl(src, url) : null;
      if (absUrl) {
        if (current && !current.imageUrl) {
          current.imageUrl = absUrl;
          current.imageAlt = $img.attr('alt') || '';
        } else {
          pendingImage = absUrl;
        }
      }
    }
  });
  flush();
  return { source: 'geeksforgeeks', title, url, steps };
}

async function scrapeDevTo(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  return scrapeHeadingBasedArticle($, url, 'devto',
    '.article-body, #article-body, article, main');
}

// Per-source discover + scrape. Returns first article with ≥3 text+image steps,
// or null if no candidate URL yields a viable article.
async function discoverAndScrape(topic, source) {
  const SITE_FOR_SERPER = {
    howtogeek: 'howtogeek.com',
    makeuseof: 'makeuseof.com',
    digitalocean: 'digitalocean.com/community/tutorials',
    freecodecamp: 'freecodecamp.org/news',
    lifewire: 'lifewire.com',
    geeksforgeeks: 'geeksforgeeks.org',
    devto: 'dev.to',
  };
  const SCRAPERS = {
    wikihow: scrapeWikiHow,
    howtogeek: scrapeHowToGeek,
    makeuseof: scrapeMakeUseOf,
    digitalocean: scrapeDigitalOcean,
    freecodecamp: scrapeFreeCodeCamp,
    lifewire: scrapeLifewire,
    geeksforgeeks: scrapeGeeksForGeeks,
    devto: scrapeDevTo,
  };

  let urls;
  if (source === 'wikihow') urls = await searchWikiHow(topic);
  else urls = await findArticleUrl(topic, SITE_FOR_SERPER[source] || source);

  const scrape = SCRAPERS[source];
  if (!scrape) return null;

  for (const url of urls) {
    try {
      const article = await scrape(url);
      const withImages = (article?.steps || []).filter((s) => s.text && s.imageUrl).length;
      if (article && withImages >= 3) return article;
    } catch (err) {
      console.warn(`[Scraper Error] scrape ${source} ${url}: ${err.message}`);
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Download images locally
// ═══════════════════════════════════════════════════════════════
async function downloadImages(steps, sessionId, emit = () => {}) {
  const sessionDir = path.join(OUT_DIR, sessionId);
  const imgDir = path.join(sessionDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  const toDownload = steps.filter((s) => s.imageUrl);
  emit('scraper:images:downloading', { total: toDownload.length });

  let downloaded = 0;
  let failed = 0;

  await Promise.all(steps.map(async (step) => {
    if (!step.imageUrl) {
      step.localImagePath = null;
      step.screenshot = null;
      return;
    }

    const filename = `step-${step.index}-raw.jpg`;
    const localPath = path.join(imgDir, filename);

    const urlHash = hashKey(step.imageUrl);
    const cached = await cacheGet('downloaded_image', urlHash);
    if (cached && cached.buffer) {
      try {
        fs.writeFileSync(localPath, cached.buffer);
        step.localImagePath = localPath;
        step.screenshot = filename;
        downloaded++;
        return;
      } catch (err) {
        console.warn(`[Scraper Error] cache restore failed: ${err.message}`);
      }
    }

    try {
      const res = await axiosInstance.get(step.imageUrl, { responseType: 'arraybuffer' });
      const buf = Buffer.from(res.data);
      fs.writeFileSync(localPath, buf);
      step.localImagePath = localPath;
      step.screenshot = filename;
      downloaded++;
      cacheSet('downloaded_image', urlHash, null, buf, 7).catch(() => {});
    } catch (err) {
      console.warn(`[Scraper Error] image download ${step.imageUrl}: ${err.message}`);
      step.localImagePath = null;
      step.screenshot = null;
      failed++;
    }
  }));

  emit('scraper:images:done', { downloaded, failed });
  return steps;
}

// ═══════════════════════════════════════════════════════════════
// Score & pick best article
// ═══════════════════════════════════════════════════════════════
function pickBestArticle(candidates, topic) {
  const topicNorm = normalize(topic);
  let best = null;
  let bestScore = -Infinity;

  for (const article of candidates) {
    if (!article || !Array.isArray(article.steps)) continue;
    let score = 0;
    const stepCount = article.steps.length;

    for (const s of article.steps) {
      if (s.text && s.imageUrl) score += 10;
      score += 5;
    }
    if (stepCount >= 5 && stepCount <= 15) score += 20;
    if (article.title && normalize(article.title).includes(topicNorm)) score += 10;

    if (score > bestScore) {
      bestScore = score;
      best = article;
    }
  }

  return best;
}

// ═══════════════════════════════════════════════════════════════
// Topic classification for source priority
// ═══════════════════════════════════════════════════════════════
const TECH_KEYWORDS = [
  'github', 'docker', 'git ', 'npm', 'yarn', 'pip', 'python', 'linux', 'ssh',
  'vscode', 'visual studio', 'node', 'nodejs', 'react', 'vue', 'angular', 'next.js', 'nextjs',
  'vercel', 'aws', 'azure', 'gcp', 'nginx', 'apache', 'mysql', 'postgres', 'mongodb',
  'database', ' api', 'rest', 'json', 'javascript', 'typescript', 'html', 'css',
  'kubernetes', 'terminal', 'bash', 'deploy', 'server', 'ubuntu', 'debian',
  'programming', 'code', 'coding', 'compile', 'webpack', 'framework', 'sdk', 'cli',
  'repository', 'repo', 'branch', 'commit', 'pull request', 'merge', 'rebase',
  'container', 'package', 'install', 'config', 'env', 'token',
  'oauth', 'jwt', 'webhook', 'cron', 'redis', 'cache',
  // expanded set
  'k8s', 'terraform', 'ansible', 'ci/cd', 'devops', 'postgresql',
  'graphql', 'django', 'flask', 'fastapi', 'spring', 'java', 'rust', 'golang',
  'machine learning', 'neural', 'pytorch', 'tensorflow', 'opencv',
  'raspberry', 'arduino', 'microcontroller', 'embedded',
];

function classifyTopic(topic) {
  const t = (topic || '').toLowerCase();
  return TECH_KEYWORDS.some((k) => t.includes(k)) ? 'tech' : 'lifestyle';
}

function priorityByCategory(category) {
  return category === 'tech'
    ? ['howtogeek', 'digitalocean', 'geeksforgeeks', 'freecodecamp', 'devto', 'lifewire', 'wikihow']
    : ['wikihow', 'lifewire', 'howtogeek', 'makeuseof'];
}

// Cap scraped article to the first 12 steps that have both an image and text.
function capViableSteps(article) {
  const MAX_STEPS = 12;
  const beforeCount = article.steps.length;
  const viable = article.steps
    .filter((s) => s.localImagePath && s.text && s.text.trim())
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .slice(0, MAX_STEPS)
    .map((s, i) => ({ ...s, index: i + 1 }));
  if (beforeCount !== viable.length) {
    console.log(`[Scraper] Capped from ${beforeCount} to ${viable.length} steps`);
  }
  return viable;
}

// ═══════════════════════════════════════════════════════════════
// Main entry point
// ═══════════════════════════════════════════════════════════════
async function scrapeForTopic(topic, sessionId, emit = () => {}, preferredSource = null) {
  const pref = preferredSource && preferredSource !== 'auto' ? preferredSource : null;
  emit('scraper:start', { topic, source: pref || 'auto' });

  // Build priority order. Preferred source goes first, then the rest of the
  // category priority list as fallback.
  const category = classifyTopic(topic);
  const basePriority = priorityByCategory(category);
  let order;
  if (pref) {
    console.log(`[Scraper] Using preferred source: ${pref}`);
    order = [pref, ...basePriority.filter((s) => s !== pref)];
  } else {
    order = basePriority;
  }

  for (const source of order) {
    emit('scraper:searching', { site: source });
    const cacheKey = `${source}:${normalize(topic)}`;

    // 1. Cache hit — skip all HTTP
    let article = null;
    try {
      const cached = await cacheGet('scraped_article', cacheKey);
      if (cached?.value && Array.isArray(cached.value.steps) && cached.value.steps.length >= 3) {
        article = JSON.parse(JSON.stringify(cached.value));
        console.log(`[Scraper] Cache hit for ${cacheKey}`);
      }
    } catch (err) {
      console.warn(`[Scraper Error] cache lookup: ${err.message}`);
    }

    // 2. Miss — discover + scrape
    if (!article) {
      try {
        article = await discoverAndScrape(topic, source);
      } catch (err) {
        console.warn(`[Scraper Error] discoverAndScrape ${source}: ${err.message}`);
      }
      if (article && article.steps.length >= 3) {
        try { await cacheSet('scraped_article', cacheKey, article, null, 7); } catch {}
      }
    }

    if (!article || article.steps.length < 3) continue;

    emit('scraper:article:found', {
      source: article.source, title: article.title,
      stepCount: article.steps.length, url: article.url,
    });
    emit('scraper:article:selected', {
      source: article.source, title: article.title, stepCount: article.steps.length,
    });

    // 3. Download + cap
    await downloadImages(article.steps, sessionId, emit);
    article.steps = capViableSteps(article);
    if (article.steps.length < 3) {
      console.warn(`[Scraper] ${source} had <3 viable steps after image download`);
      continue;
    }

    if (pref && source !== pref) {
      emit('scraper:fallback:source', { requested: pref, using: source });
    }
    emit('scraper:done', { source: article.source, stepCount: article.steps.length });
    return article;
  }

  emit('scraper:fallback:source', { requested: pref || 'auto', using: null });
  return null;
}

module.exports = {
  scrapeWikiHow,
  scrapeHowToGeek,
  scrapeMakeUseOf,
  scrapeDigitalOcean,
  scrapeFreeCodeCamp,
  scrapeLifewire,
  scrapeGeeksForGeeks,
  scrapeDevTo,
  findArticleUrl,
  downloadImages,
  classifyTopic,
  priorityByCategory,
  scrapeForTopic,
};
