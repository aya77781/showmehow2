const Anthropic = require('@anthropic-ai/sdk');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { normalize, hashKey, hashBuffer, cacheGet, cacheSet, saveImage, findImages, markUsed } = require('./cache');
const Project = require('../models/Project');

const client = new Anthropic();

// ── ElevenLabs TTS ──
const ELEVENLABS_KEYS = [process.env.ELEVENLABS_API_KEY, process.env.ELEVENLABS_API_KEY_BACKUP].filter(Boolean);

async function elevenLabsTTS(text, outputPath) {
  const cleanText = text.replace(/<[^>]+>/g, '');
  for (let i = 0; i < ELEVENLABS_KEYS.length; i++) {
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL', {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_KEYS[i],
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`ElevenLabs ${res.status}: ${errText.slice(0, 100)}`);
      }
      fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
      console.log(`[TTS] ElevenLabs succeeded with key #${i + 1}`);
      return outputPath;
    } catch (err) {
      console.warn(`[TTS] ElevenLabs key #${i + 1} failed: ${err.message}`);
      if (i === ELEVENLABS_KEYS.length - 1) throw err;
    }
  }
  throw new Error('All ElevenLabs keys exhausted');
}

const OUT_DIR = path.resolve(__dirname, '..', 'output', 'sessions');

// ═══════════════════════════════════════════════════════════════
// Claude → tutorial script (cached by normalized topic)
// ═══════════════════════════════════════════════════════════════
async function generateScript(topic) {
  const cacheKey = normalize(topic);
  const cached = await cacheGet('script', cacheKey);
  if (cached) return cached.value;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{
      role: 'user',
      content: `You are a tutorial script writer for SHORT video tutorials. Create a step-by-step tutorial for: "${topic}"

RULES:
- Use web_search to find the real website/app for this topic
- 8-12 steps — each step is ONE micro-action (click one button, fill one field, etc.)
- Each description must be EXACTLY 5-10 words — short enough for a 2-second voiceover
- imageQuery must be ULTRA-SPECIFIC: "[SiteName] [exact page name] [exact UI element] screenshot 2025"
  Example: "GitHub new repository page name input field screenshot 2025"
  Example: "Gmail compose window subject line text field screenshot 2025"
- ALWAYS include "2025" or "2024" in imageQuery to get the LATEST modern UI — never search for old designs
- Every step MUST have a different imageQuery — never repeat the same query
- Steps should show DIFFERENT screens/sections of the UI

Return ONLY valid JSON:
{
  "title": "How to...",
  "url": "https://...",
  "intro": "Short welcome, 5-8 words max.",
  "outro": "Short closing, 5-8 words max.",
  "steps": [
    {
      "step": 1,
      "title": "Verb + Object (3-5 words)",
      "description": "Short voiceover, 5-10 words exactly.",
      "imageQuery": "SiteName exact page exact element screenshot interface"
    }
  ]
}`
    }]
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
  const i = text.indexOf('{'), j = text.lastIndexOf('}');
  if (i === -1) throw new Error('No JSON from Claude');
  const script = JSON.parse(text.slice(i, j + 1));
  const strip = s => s ? s.replace(/<[^>]+>/g, '').trim() : s;
  if (script.steps) script.steps.forEach(s => { s.description = strip(s.description); });
  script.intro = strip(script.intro);
  script.outro = strip(script.outro);

  await cacheSet('script', cacheKey, script, null, 7);
  return script;
}

function detectMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
}

// ═══════════════════════════════════════════════════════════════
// Serper image search (cached by normalized query)
// ═══════════════════════════════════════════════════════════════
async function searchAndDownload(query, maxResults = 10) {
  const cacheKey = normalize(query);
  const cached = await cacheGet('image_search', cacheKey);
  if (cached) return cached.value;

  const res = await fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, gl: 'us', hl: 'en', num: maxResults, tbs: 'qdr:y2' }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const results = (data.images || []).slice(0, maxResults);

  await cacheSet('image_search', cacheKey, results, null, 3);
  return results;
}

async function downloadImages(images) {
  const downloads = await Promise.allSettled(
    images.map(img =>
      fetch(img.imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
      }).then(async r => {
        if (!r.ok) throw new Error('not ok');
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 5000) throw new Error('too small');
        return buf;
      })
    )
  );
  return downloads
    .filter(d => d.status === 'fulfilled')
    .map(d => d.value)
    .filter(buf => {
      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50;
      return isJpeg || isPng;
    });
}

// ═══════════════════════════════════════════════════════════════
// Image selection — library first, then Serper + Claude Vision
// ═══════════════════════════════════════════════════════════════
async function fetchStepImages(step, imgDir, _tutorialTitle, emit) {
  const stepNum = String(step.step).padStart(2, '0');
  const primaryQuery = step.imageQuery || `${step.title} screenshot`;
  emit('screenshot:search', { step: step.step, query: primaryQuery });

  // ── Layer 0: Check image library for pre-validated matches ──
  const libraryMatches = await findImages(primaryQuery, 3);
  if (libraryMatches.length > 0) {
    const best = libraryMatches[0]; // highest scored match
    const mainFile = `step-${stepNum}.png`;
    fs.writeFileSync(path.join(imgDir, mainFile), best.buffer);
    await markUsed(best.hash);

    step.screenshot = mainFile;
    step.candidates = [];
    step.validCandidates = [];
    step.picked = 0;
    step.fromLibrary = true;

    // If the library image has cached annotation data, carry it forward
    if (best.annotationData) {
      step._cachedAnnotation = best.annotationData;
    }

    emit('screenshot:library', { step: step.step, score: best.score, site: best.site, uses: best.uses });
    emit('screenshot:done', { step: step.step, picked: 1, total: 1, valid: 1, candidates: [], fromLibrary: true });
    return true;
  }

  // ── Layer 1+2: Serper search (cached) + download ──
  const allImages = await searchAndDownload(primaryQuery, 8);
  if (allImages.length === 0) return false;

  const candidates = (await downloadImages(allImages)).slice(0, 5);
  if (candidates.length === 0) return false;

  const candidateFiles = [];
  candidates.forEach((buf, i) => {
    const ext = buf[0] === 0x89 ? 'png' : 'jpg';
    const file = `step-${stepNum}-c${i + 1}.${ext}`;
    fs.writeFileSync(path.join(imgDir, file), buf);
    candidateFiles.push(file);
  });

  // ── Layer 3: Claude Vision pick (cached by query + image hashes) ──
  const imageHashes = candidates.map(buf => hashBuffer(buf));
  const pickCacheKey = hashKey(normalize(primaryQuery), ...imageHashes);

  let picked = 0;
  let validCandidates = candidateFiles;

  const cachedPick = await cacheGet('image_pick', pickCacheKey);
  if (cachedPick) {
    picked = cachedPick.value.picked;
    const cachedValid = cachedPick.value.validIndices;
    if (cachedValid && cachedValid.length > 0) {
      validCandidates = cachedValid.filter(n => n < candidateFiles.length).map(n => candidateFiles[n]);
    }
    emit('screenshot:cached', { step: step.step });
  } else {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: [
              ...candidates.map((buf) => ({
                type: 'image',
                source: { type: 'base64', media_type: detectMime(buf), data: buf.toString('base64') },
              })),
              {
                type: 'text',
                text: `Pick the best screenshot for tutorial step: "${step.title}" — "${step.description || ''}".
You see ${candidates.length} images (1-${candidates.length}).
Pick the real UI screenshot that best matches this step. Reject illustrations, logos, stock photos, old designs.

Reply EXACTLY:
VALID: 1,3,5
BEST: 3

If none valid: VALID: NONE / BEST: 0`,
              },
            ],
          },
        ],
      });

      const text = response.content[0].text.trim();

      const validLine = text.match(/VALID:\s*(.+)/i);
      if (validLine) {
        const validStr = validLine[1].trim();
        if (validStr === 'NONE') {
          validCandidates = [];
        } else {
          const validNums = validStr.match(/\d+/g)?.map(n => parseInt(n) - 1).filter(n => n >= 0 && n < candidates.length) || [];
          if (validNums.length > 0) {
            validCandidates = validNums.map(n => candidateFiles[n]);
          }
        }
      }

      const bestLine = text.match(/BEST:\s*(\d+)/i);
      if (bestLine) {
        const choice = parseInt(bestLine[1]) - 1;
        if (choice >= 0 && choice < candidates.length) {
          picked = choice;
        } else if (validCandidates.length > 0) {
          picked = candidateFiles.indexOf(validCandidates[0]);
        }
      }

      if (validCandidates.length > 0 && !validCandidates.includes(candidateFiles[picked])) {
        picked = candidateFiles.indexOf(validCandidates[0]);
      }

      const validIndices = validCandidates.map(f => candidateFiles.indexOf(f));
      await cacheSet('image_pick', pickCacheKey, { picked, validIndices }, null, 7);
    } catch (err) {
      console.error(`Vision pick error step ${step.step}:`, err.message);
    }
  }

  // Copy picked as main screenshot
  const mainFile = `step-${stepNum}.png`;
  fs.copyFileSync(path.join(imgDir, candidateFiles[picked]), path.join(imgDir, mainFile));

  // ── Save validated images to library for future reuse ──
  const validIndicesForLib = validCandidates.map(f => candidateFiles.indexOf(f)).filter(i => i >= 0);
  for (const idx of validIndicesForLib) {
    await saveImage(candidates[idx], primaryQuery, {
      validated: true,
      tags: [normalize(step.title)].concat(normalize(step.description || '').split(' ').filter(w => w.length > 2)),
    });
  }

  step.screenshot = mainFile;
  step.candidates = candidateFiles;
  step.validCandidates = validCandidates;
  step.picked = picked;

  emit('screenshot:done', {
    step: step.step,
    picked: picked + 1,
    total: candidates.length,
    valid: validCandidates.length,
    candidates: candidateFiles,
  });
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Annotate screenshot (cached by image hash + step description)
// ═══════════════════════════════════════════════════════════════
async function annotateScreenshot(step, imgDir, _tutorialTitle, emit) {
  const stepNum = String(step.step).padStart(2, '0');
  const mainFile = `step-${stepNum}.png`;
  const mainPath = path.join(imgDir, mainFile);
  if (!fs.existsSync(mainPath)) return;

  const buf = fs.readFileSync(mainPath);
  const metadata = await sharp(buf).metadata();
  const imgW = metadata.width || 1280;
  const imgH = metadata.height || 720;

  // Cache key: hash of image content + step text
  const imgHash = hashBuffer(buf);
  const annoCacheKey = hashKey(imgHash, normalize(step.title + ' ' + (step.description || '')));

  let boxData = null;

  // Check: library annotation from fetchStepImages
  if (step._cachedAnnotation) {
    boxData = step._cachedAnnotation;
    delete step._cachedAnnotation;
    emit('screenshot:annotated:cached', { step: step.step, source: 'library' });
  }

  // Check: TTL cache
  if (!boxData) {
    const cachedAnno = await cacheGet('annotation', annoCacheKey);
    if (cachedAnno) {
      boxData = cachedAnno.value;
      emit('screenshot:annotated:cached', { step: step.step, source: 'cache' });
    }
  }

  if (!boxData) {
    // Ask Claude to identify the UI region to highlight
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: detectMime(buf), data: buf.toString('base64') },
            },
            {
              type: 'text',
              text: `Step: "${step.title}" — "${step.description || ''}"
Find the UI element for this step. Reply EXACTLY:
BOX: x1%,y1%,x2%,y2%
LABEL: short label
Or: NONE`,
            },
          ],
        }],
      });

      const text = response.content[0].text.trim();
      if (text === 'NONE' || !text.includes('BOX:')) return;

      const boxMatch = text.match(/BOX:\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
      const labelMatch = text.match(/LABEL:\s*(.+)/i);
      if (!boxMatch) return;

      boxData = {
        x1p: parseFloat(boxMatch[1]),
        y1p: parseFloat(boxMatch[2]),
        x2p: parseFloat(boxMatch[3]),
        y2p: parseFloat(boxMatch[4]),
        label: labelMatch ? labelMatch[1].trim().slice(0, 30) : '',
      };

      await cacheSet('annotation', annoCacheKey, boxData, null, 30);

      // Save annotation data back to image library for future reuse
      await saveImage(buf, step.imageQuery || step.title, { annotationData: boxData });
    } catch (err) {
      console.error(`Annotation error step ${step.step}:`, err.message);
      return;
    }
  }

  if (!boxData) return;

  // Render the annotation with Sharp
  const x1 = Math.round((boxData.x1p / 100) * imgW);
  const y1 = Math.round((boxData.y1p / 100) * imgH);
  const x2 = Math.round((boxData.x2p / 100) * imgW);
  const y2 = Math.round((boxData.y2p / 100) * imgH);
  const label = boxData.label || '';

  const bx = Math.max(0, Math.min(x1, x2));
  const by = Math.max(0, Math.min(y1, y2));
  const bw = Math.min(Math.abs(x2 - x1), imgW - bx);
  const bh = Math.min(Math.abs(y2 - y1), imgH - by);

  if (bw < 10 || bh < 10) return;

  const padding = 4;
  const strokeWidth = 3;
  const fontSize = Math.max(14, Math.min(20, Math.round(imgH / 40)));
  const labelH = fontSize + 10;
  const labelW = Math.min(label.length * (fontSize * 0.6) + 16, imgW - 10);
  const labelX = Math.max(4, Math.min(bx, imgW - labelW - 4));
  const labelYAbove = by - labelH - 4;
  const labelYBelow = by + bh + 4;
  const labelY = labelYAbove >= 0 ? labelYAbove : (labelYBelow + labelH <= imgH ? labelYBelow : Math.max(0, by - labelH));

  const escSvg = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const rx = Math.max(0, bx - padding);
  const ry = Math.max(0, by - padding);
  const rw = Math.min(bw + padding * 2, imgW - rx);
  const rh = Math.min(bh + padding * 2, imgH - ry);

  let svgOverlay = `<svg width="${imgW}" height="${imgH}">
      <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}"
            rx="6" ry="6" fill="none" stroke="#6366f1" stroke-width="${strokeWidth}" />
      <rect x="${Math.max(0, rx - 1)}" y="${Math.max(0, ry - 1)}" width="${Math.min(rw + 2, imgW)}" height="${Math.min(rh + 2, imgH)}"
            rx="7" ry="7" fill="none" stroke="rgba(99,102,241,0.3)" stroke-width="${strokeWidth + 4}" />`;

  if (label) {
    svgOverlay += `
      <rect x="${labelX}" y="${labelY}" width="${labelW}" height="${labelH}" rx="4" ry="4" fill="#6366f1" />
      <text x="${labelX + 8}" y="${labelY + fontSize + 2}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="white">${escSvg(label)}</text>`;
  }

  svgOverlay += `</svg>`;

  const annotated = await sharp(buf)
    .composite([{ input: Buffer.from(svgOverlay), gravity: 'northwest' }])
    .png()
    .toBuffer();

  const annotatedFile = `step-${stepNum}-annotated.png`;
  fs.writeFileSync(path.join(imgDir, annotatedFile), annotated);
  fs.writeFileSync(mainPath, annotated);

  step.annotated = true;
  step.highlightLabel = label;
  emit('screenshot:annotated', { step: step.step, label });
}

// ═══════════════════════════════════════════════════════════════
// Fetch ALL step images in parallel
// ═══════════════════════════════════════════════════════════════
async function fetchAllImages(steps, imgDir, tutorialTitle, emit = () => {}) {
  emit('research:screenshots:start', { total: steps.length });

  const results = await Promise.all(
    steps.map(step => fetchStepImages(step, imgDir, tutorialTitle, emit))
  );

  const count = results.filter(Boolean).length;
  emit('research:screenshots:done', { count });

  emit('annotation:start', { total: count });
  await Promise.all(
    steps.filter(s => s.screenshot).map(step => annotateScreenshot(step, imgDir, tutorialTitle, emit))
  );
  emit('annotation:done', {});

  return count;
}

// ═══════════════════════════════════════════════════════════════
// TTS — ElevenLabs (cached by text hash)
// ═══════════════════════════════════════════════════════════════
async function generateTTS(text, outputPath) {
  if (ELEVENLABS_KEYS.length === 0) {
    throw new Error('No ElevenLabs key configured');
  }

  const cacheKey = hashKey(normalize(text));
  const cached = await cacheGet('tts', cacheKey);
  if (cached && cached.buffer) {
    fs.writeFileSync(outputPath, cached.buffer);
    return outputPath;
  }

  await elevenLabsTTS(text, outputPath);

  const audioBuf = fs.readFileSync(outputPath);
  await cacheSet('tts', cacheKey, null, audioBuf, 30);
  return outputPath;
}

function concatenateVideos(clipPaths, outputPath) {
  const listFile = outputPath.replace('.mp4', '-list.txt');
  fs.writeFileSync(listFile, clipPaths.map(p => `file '${p}'`).join('\n'));
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -c:a aac -movflags +faststart "${outputPath}"`,
    { stdio: 'ignore', timeout: 120000 }
  );
  fs.unlinkSync(listFile);
  return outputPath;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1: Research — check for existing project first, then generate
// ═══════════════════════════════════════════════════════════════
async function runResearch(topic, emit = () => {}) {
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const sessionDir = path.join(OUT_DIR, sessionId);
  const imgDir = path.join(sessionDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  const t0 = Date.now();
  emit('research:start', { sessionId, topic });

  // ── Shortcut: check if a completed project with this topic exists ──
  const normalizedTopic = normalize(topic);
  try {
    const existing = await Project.findOne({
      status: 'complete',
      sessionId: { $exists: true, $ne: null },
    }).lean();

    if (existing && normalize(existing.topic) === normalizedTopic && existing.sessionId) {
      const existingDir = path.join(OUT_DIR, existing.sessionId, 'images');
      if (fs.existsSync(existingDir)) {
        // Clone session files
        const files = fs.readdirSync(existingDir);
        for (const f of files) {
          fs.copyFileSync(path.join(existingDir, f), path.join(imgDir, f));
        }
        const tutorial = existing.tutorial;
        emit('research:cached', { sessionId, originalSession: existing.sessionId });
        emit('research:claude:start', {});
        emit('research:claude:done', {
          steps: tutorial.steps, intro: tutorial.intro, outro: tutorial.outro, time: Date.now() - t0,
        });
        emit('research:screenshots:start', { total: tutorial.steps.length });
        emit('research:screenshots:done', { count: tutorial.steps.filter(s => s.screenshot).length });
        emit('annotation:done', {});

        tutorial.source = 'Cached';
        const result = {
          sessionId,
          tutorial,
          stats: { images: tutorial.steps.filter(s => s.screenshot).length, phase1Time: Date.now() - t0, cached: true },
        };
        emit('research:done', result);
        return result;
      }
    }
  } catch (err) {
    console.warn('[cache] Project lookup failed:', err.message);
  }

  // 1. Claude generates script (cached internally)
  emit('research:claude:start', {});
  const tutorial = await generateScript(topic);
  emit('research:claude:done', {
    steps: tutorial.steps, intro: tutorial.intro, outro: tutorial.outro, time: Date.now() - t0,
  });

  // 2. Fetch all images in parallel — Claude validates each one
  const imgCount = await fetchAllImages(tutorial.steps, imgDir, tutorial.title, emit);

  tutorial.source = 'Serper + Claude Vision';
  const phase1Time = Date.now() - t0;
  const result = { sessionId, tutorial, stats: { images: imgCount, phase1Time } };
  emit('research:done', result);
  return result;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2: Generate final video
// ═══════════════════════════════════════════════════════════════
async function runVideoGeneration(sessionId, steps, tutorial, emit = () => {}) {
  const sessionDir = path.join(OUT_DIR, sessionId);
  const audioDir = path.join(sessionDir, 'audio');
  const vidDir = path.join(sessionDir, 'videos');
  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(vidDir, { recursive: true });

  const t0 = Date.now();
  const intro = tutorial.intro || `Welcome to this tutorial.`;
  const outro = tutorial.outro || `That's it, you're done!`;

  const narrations = [
    { text: intro, id: 'intro' },
    ...steps.map((s, i) => ({ text: s.description || s.title, id: `step-${i + 1}` })),
    { text: outro, id: 'outro' },
  ];
  const imgDir = path.join(sessionDir, 'images');

  emit('tts:start', { total: narrations.length });
  emit('video:start', { total: narrations.length });

  // Slideshow mode: TTS (cached) + screenshot → mp4
  const pipelineResults = await Promise.all(
    narrations.map(async (n) => {
      let ttsFile;
      try {
        ttsFile = await generateTTS(n.text, path.join(audioDir, `${n.id}.wav`));
        emit('tts:done', { id: n.id });
      } catch (err) {
        emit('tts:error', { id: n.id, error: err.message });
        return null;
      }

      let bgImage = null;
      if (n.id === 'intro') bgImage = steps[0]?.screenshot ? path.join(imgDir, steps[0].screenshot) : null;
      else if (n.id === 'outro') bgImage = steps[steps.length - 1]?.screenshot ? path.join(imgDir, steps[steps.length - 1].screenshot) : null;
      else {
        const idx = parseInt(n.id.split('-')[1]) - 1;
        bgImage = steps[idx]?.screenshot ? path.join(imgDir, steps[idx].screenshot) : null;
      }

      const clipFile = path.join(vidDir, `${n.id}.mp4`);

      if (bgImage && fs.existsSync(bgImage)) {
        try {
          await execAsync(
            `ffmpeg -y -loop 1 -i "${bgImage}" -i "${ttsFile}" ` +
            `-filter_complex "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black[v]" ` +
            `-map "[v]" -map 1:a -c:v libx264 -c:a aac -b:a 128k -pix_fmt yuv420p -movflags +faststart -shortest "${clipFile}"`,
            { timeout: 30000 }
          );
          emit('video:clip:done', { label: n.id, file: path.basename(clipFile), size: fs.statSync(clipFile).size });
          return clipFile;
        } catch (err) {
          emit('video:clip:error', { label: n.id, error: err.message });
          return null;
        }
      }
      return null;
    })
  );

  const compositeClips = pipelineResults.filter(Boolean);
  emit('tts:complete', { success: compositeClips.length, time: Date.now() - t0 });
  emit('video:clips:done', { success: compositeClips.length, total: narrations.length, time: Date.now() - t0 });

  const finalPath = path.join(sessionDir, 'final-video.mp4');
  if (compositeClips.length > 0) {
    emit('video:concatenating', { clips: compositeClips.length });
    try {
      concatenateVideos(compositeClips, finalPath);
      emit('video:final', { file: 'final-video.mp4', size: fs.statSync(finalPath).size, clips: compositeClips.length });
    } catch (err) {
      emit('video:error', { error: 'Concat failed: ' + err.message });
    }
  }

  const phase2Time = Date.now() - t0;
  const hasFinal = fs.existsSync(finalPath);

  steps.forEach((step, i) => {
    const clipFile = `step-${i + 1}.mp4`;
    const clipPath = path.join(vidDir, clipFile);
    if (fs.existsSync(clipPath)) {
      step.video = clipFile;
      step.videoSize = fs.statSync(clipPath).size;
    }
  });

  const result = {
    steps,
    finalVideo: hasFinal ? 'final-video.mp4' : null,
    finalVideoSize: hasFinal ? fs.statSync(finalPath).size : 0,
    clips: compositeClips.length,
    time: phase2Time,
  };
  emit('video:done', result);
  return result;
}

module.exports = { runResearch, runVideoGeneration };
