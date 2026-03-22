const Anthropic = require('@anthropic-ai/sdk');
const { fal } = require('@fal-ai/client');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const client = new Anthropic();

// ── fal.ai key management with auto-fallback ──
const FAL_KEYS = [process.env.FAL_KEY, process.env.FAL_KEY_BACKUP].filter(Boolean);
let falKeyIndex = 0;

function activateFalKey(index) {
  if (FAL_KEYS[index]) {
    falKeyIndex = index;
    fal.config({ credentials: FAL_KEYS[index] });
    console.log(`[fal] Using key #${index + 1}`);
  }
}
activateFalKey(0);

function switchFalKey() {
  const next = (falKeyIndex + 1) % FAL_KEYS.length;
  if (next === falKeyIndex) return false; // no other key
  activateFalKey(next);
  return true;
}

async function falWithRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    const msg = err?.message || '';
    const isKeyError = msg.includes('401') || msg.includes('403') || msg.includes('quota') || msg.includes('rate') || msg.includes('limit') || msg.includes('unauthorized') || msg.includes('Unauthorized');
    if (isKeyError && switchFalKey()) {
      console.log(`[fal] Key failed (${msg.slice(0, 80)}), retrying with backup key...`);
      return await fn();
    }
    throw err;
  }
}

// ── ElevenLabs TTS fallback ──
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
      console.log(`[TTS] ElevenLabs fallback succeeded with key #${i + 1}`);
      return outputPath;
    } catch (err) {
      console.warn(`[TTS] ElevenLabs key #${i + 1} failed: ${err.message}`);
      if (i === ELEVENLABS_KEYS.length - 1) throw err;
    }
  }
  throw new Error('All ElevenLabs keys exhausted');
}

const SKIP_AVATAR = process.env.SKIP_AVATAR === 'true';

const OUT_DIR = path.resolve(__dirname, '..', 'output', 'sessions');
const ASSETS_DIR = path.resolve(__dirname, '..', 'assets');

// ═══════════════════════════════════════════════════════════════
// Avatar — generate once with FLUX, reuse for all videos
// ═══════════════════════════════════════════════════════════════
async function getOrCreateAvatar() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const avatarPath = path.join(ASSETS_DIR, 'avatar.png');
  if (fs.existsSync(avatarPath)) return avatarPath;

  const result = await falWithRetry(() => fal.subscribe('fal-ai/flux/dev', {
    input: {
      prompt: 'Professional young woman, late 20s, friendly warm smile, looking directly at camera, shoulders up headshot portrait, solid light gray background, studio lighting, photorealistic, high quality',
      image_size: { width: 512, height: 512 },
      num_images: 1,
    },
  }));
  const imageUrl = result.data?.images?.[0]?.url;
  if (!imageUrl) throw new Error('Failed to generate avatar');
  const res = await fetch(imageUrl);
  fs.writeFileSync(avatarPath, Buffer.from(await res.arrayBuffer()));
  return avatarPath;
}

async function uploadToFal(filePath, mimeType) {
  return await falWithRetry(async () => {
    const buffer = fs.readFileSync(filePath);
    const blob = new Blob([buffer], { type: mimeType });
    return await fal.storage.upload(blob);
  });
}

// ═══════════════════════════════════════════════════════════════
// Claude → tutorial script (short descriptions for ~2s clips)
// ═══════════════════════════════════════════════════════════════
async function generateScript(topic) {
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
// Serper image search — two queries for diversity, download all
// ═══════════════════════════════════════════════════════════════
async function searchAndDownload(query, maxResults = 10) {
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
  return (data.images || []).slice(0, maxResults);
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
// Claude Vision — single call: pick best + mark valid/invalid
// ═══════════════════════════════════════════════════════════════
async function fetchStepImages(step, imgDir, tutorialTitle, emit) {
  const stepNum = String(step.step).padStart(2, '0');

  // Two search queries for more diversity
  const primaryQuery = step.imageQuery || `${step.title} screenshot`;
  const fallbackQuery = `${step.title} UI screenshot tutorial 2025`;
  emit('screenshot:search', { step: step.step, query: primaryQuery });

  // Run both searches in parallel
  const [primaryImages, fallbackImages] = await Promise.all([
    searchAndDownload(primaryQuery, 8),
    searchAndDownload(fallbackQuery, 6),
  ]);

  // Deduplicate by URL and merge
  const seen = new Set();
  const allImages = [];
  for (const img of [...primaryImages, ...fallbackImages]) {
    if (!seen.has(img.imageUrl)) {
      seen.add(img.imageUrl);
      allImages.push(img);
    }
  }

  if (allImages.length === 0) return false;

  // Download all, keep up to 8 valid JPEG/PNG
  const candidates = (await downloadImages(allImages)).slice(0, 8);
  if (candidates.length === 0) return false;

  // Save ALL candidates
  const candidateFiles = [];
  candidates.forEach((buf, i) => {
    const ext = buf[0] === 0x89 ? 'png' : 'jpg';
    const file = `step-${stepNum}-c${i + 1}.${ext}`;
    fs.writeFileSync(path.join(imgDir, file), buf);
    candidateFiles.push(file);
  });

  // ── Single Claude Vision call: pick best + classify all ──
  let picked = 0;
  let validCandidates = candidateFiles; // fallback: all valid
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            ...candidates.map((buf, i) => ({
              type: 'image',
              source: { type: 'base64', media_type: detectMime(buf), data: buf.toString('base64') },
            })),
            {
              type: 'text',
              text: `TUTORIAL: "${tutorialTitle || ''}"
STEP ${step.step}: "${step.title}"
ACTION: "${step.description || ''}"
SEARCH QUERY: "${primaryQuery}"

You are an expert image selector for video tutorials. You see ${candidates.length} candidate images numbered 1-${candidates.length}.

TASK 1 — CLASSIFY each image:
For a tutorial step, the PERFECT image must be:
✓ A REAL screenshot of the actual website/app UI (not an illustration, diagram, icon, logo, or photo of a person)
✓ Showing the EXACT page, screen, or dialog described in this step (not the homepage when step is about a settings page)
✓ The UI elements mentioned in the step title/description must be VISIBLE (buttons, input fields, menus, etc.)
✓ High quality: clear, readable text, not blurry, not heavily cropped, not a tiny thumbnail
✓ MODERN UI: must look like the current/latest version of the site (2024-2025 design). Prefer flat design, modern typography, rounded corners
✗ REJECT: blog post thumbnails, marketing banners, stock photos, illustrations, infographics, logos, mobile screenshots when step is desktop (and vice versa), screenshots of a DIFFERENT website/app
✗ REJECT: OLD/OUTDATED UI designs — if the screenshot looks like a 2015-2020 era design with old logos, old layouts, or deprecated features, mark it INVALID

TASK 2 — PICK the single best image that most precisely matches this tutorial step.

Reply in this EXACT format (no other text):
VALID: 1,3,5
BEST: 3

If NO images are valid screenshots for this step:
VALID: NONE
BEST: 0`,
            },
          ],
        },
      ],
    });

    const text = response.content[0].text.trim();

    // Parse VALID line
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

    // Parse BEST line
    const bestLine = text.match(/BEST:\s*(\d+)/i);
    if (bestLine) {
      const choice = parseInt(bestLine[1]) - 1;
      if (choice >= 0 && choice < candidates.length) {
        picked = choice;
      } else if (validCandidates.length > 0) {
        // BEST was 0 or invalid — pick first valid
        picked = candidateFiles.indexOf(validCandidates[0]);
      }
    }

    // Safety: if picked image is not in validCandidates, pick first valid
    if (validCandidates.length > 0 && !validCandidates.includes(candidateFiles[picked])) {
      picked = candidateFiles.indexOf(validCandidates[0]);
    }
  } catch (err) {
    console.error(`Vision pick error step ${step.step}:`, err.message);
  }

  // ── Double-check: Claude picks the definitive best from top valid candidates ──
  if (validCandidates.length >= 2) {
    try {
      const topIndices = validCandidates
        .map(f => candidateFiles.indexOf(f))
        .filter(i => i >= 0)
        .slice(0, 4); // top 4 valid candidates

      const dcResponse = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: [
            ...topIndices.map(idx => ({
              type: 'image',
              source: { type: 'base64', media_type: detectMime(candidates[idx]), data: candidates[idx].toString('base64') },
            })),
            {
              type: 'text',
              text: `TUTORIAL: "${tutorialTitle || ''}"
STEP ${step.step}: "${step.title}" — "${step.description || ''}"

You see ${topIndices.length} pre-validated screenshots. Pick the ONE that BEST matches this exact tutorial step.
Criteria: clearest UI, most relevant screen, highest quality, most readable text.

Reply ONLY with the number (1-${topIndices.length}):`,
            },
          ],
        }],
      });

      const dcText = dcResponse.content[0].text.trim();
      const dcMatch = dcText.match(/(\d+)/);
      if (dcMatch) {
        const dcChoice = parseInt(dcMatch[1]) - 1;
        if (dcChoice >= 0 && dcChoice < topIndices.length) {
          picked = topIndices[dcChoice];
        }
      }
    } catch (err) {
      console.error(`Double-check error step ${step.step}:`, err.message);
    }
  }

  // Copy picked as main screenshot
  const mainFile = `step-${stepNum}.png`;
  fs.copyFileSync(path.join(imgDir, candidateFiles[picked]), path.join(imgDir, mainFile));

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
// Annotate screenshot — Claude identifies region, Sharp draws highlight
// ═══════════════════════════════════════════════════════════════
async function annotateScreenshot(step, imgDir, tutorialTitle, emit) {
  const stepNum = String(step.step).padStart(2, '0');
  const mainFile = `step-${stepNum}.png`;
  const mainPath = path.join(imgDir, mainFile);
  if (!fs.existsSync(mainPath)) return;

  const buf = fs.readFileSync(mainPath);
  const metadata = await sharp(buf).metadata();
  const imgW = metadata.width || 1280;
  const imgH = metadata.height || 720;

  // Ask Claude to identify the UI region to highlight
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: detectMime(buf), data: buf.toString('base64') },
          },
          {
            type: 'text',
            text: `TUTORIAL: "${tutorialTitle || ''}"
STEP ${step.step}: "${step.title}" — "${step.description || ''}"

Look at this screenshot. Identify the EXACT UI element the user should interact with in this step (button, input field, menu item, link, etc.).

Give me the bounding box as percentages of the image dimensions.
Reply in this EXACT format (no other text):
BOX: x1%,y1%,x2%,y2%
LABEL: short label (2-4 words)

Example:
BOX: 65%,8%,82%,14%
LABEL: New Repository button

If no specific element can be identified, reply: NONE`,
          },
        ],
      }],
    });

    const text = response.content[0].text.trim();
    if (text === 'NONE' || !text.includes('BOX:')) return;

    const boxMatch = text.match(/BOX:\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
    const labelMatch = text.match(/LABEL:\s*(.+)/i);
    if (!boxMatch) return;

    const x1 = Math.round((parseFloat(boxMatch[1]) / 100) * imgW);
    const y1 = Math.round((parseFloat(boxMatch[2]) / 100) * imgH);
    const x2 = Math.round((parseFloat(boxMatch[3]) / 100) * imgW);
    const y2 = Math.round((parseFloat(boxMatch[4]) / 100) * imgH);
    const label = labelMatch ? labelMatch[1].trim().slice(0, 30) : '';

    // Clamp coordinates
    const bx = Math.max(0, Math.min(x1, x2));
    const by = Math.max(0, Math.min(y1, y2));
    const bw = Math.min(Math.abs(x2 - x1), imgW - bx);
    const bh = Math.min(Math.abs(y2 - y1), imgH - by);

    if (bw < 10 || bh < 10) return; // too small

    // Draw highlight rectangle + label with Sharp SVG overlay
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

    // Ensure rect coords are positive
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

    // Save annotated version as the main screenshot
    const annotatedFile = `step-${stepNum}-annotated.png`;
    fs.writeFileSync(path.join(imgDir, annotatedFile), annotated);
    // Replace main with annotated
    fs.writeFileSync(mainPath, annotated);

    step.annotated = true;
    step.highlightLabel = label;
    emit('screenshot:annotated', { step: step.step, label });
  } catch (err) {
    console.error(`Annotation error step ${step.step}:`, err.message);
  }
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

  // Annotate all screenshots — highlight the key UI element
  emit('annotation:start', { total: count });
  await Promise.all(
    steps.filter(s => s.screenshot).map(step => annotateScreenshot(step, imgDir, tutorialTitle, emit))
  );
  emit('annotation:done', {});

  return count;
}

// ═══════════════════════════════════════════════════════════════
// TTS — xAI via fal.ai
// ═══════════════════════════════════════════════════════════════
async function generateTTS(text, outputPath) {
  // Try xAI TTS via fal.ai first
  try {
    const result = await falWithRetry(() => fal.subscribe('xai/tts/v1', {
      input: { text: text.replace(/<[^>]+>/g, ''), voice: 'eve', language: 'en' },
    }));
    const audioUrl = result.data?.audio?.url;
    if (!audioUrl) throw new Error('No audio from xAI TTS');
    const res = await fetch(audioUrl);
    fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
    return outputPath;
  } catch (err) {
    console.warn(`[TTS] xAI failed (${err.message}), trying ElevenLabs fallback...`);
  }
  // Fallback: ElevenLabs
  if (ELEVENLABS_KEYS.length > 0) {
    return await elevenLabsTTS(text, outputPath);
  }
  throw new Error('All TTS providers failed and no ElevenLabs key configured');
}

// ═══════════════════════════════════════════════════════════════
// VEED Fabric 1.0 — avatar + audio → talking head
// ═══════════════════════════════════════════════════════════════
async function generateTalkingClip(avatarUrl, audioPath, outputPath, emit, label) {
  const audioUrl = await uploadToFal(audioPath, 'audio/wav');
  emit('video:clip:progress', { label, status: 'GENERATING' });

  const result = await falWithRetry(() => fal.subscribe('veed/fabric-1.0', {
    input: { image_url: avatarUrl, audio_url: audioUrl, resolution: '480p' },
    onQueueUpdate(update) {
      emit('video:clip:progress', { label, status: update.status, position: update.position || null });
    },
  }));

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) throw new Error('No video from VEED');
  const res = await fetch(videoUrl);
  const videoBuffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, videoBuffer);
  emit('video:clip:done', { label, file: path.basename(outputPath), size: videoBuffer.length });
  return outputPath;
}

// ═══════════════════════════════════════════════════════════════
// ffmpeg compositing + concatenation
// ═══════════════════════════════════════════════════════════════
function compositeClip(stepImagePath, avatarClipPath, outputPath) {
  execSync(
    `ffmpeg -y -loop 1 -i "${stepImagePath}" -i "${avatarClipPath}" ` +
    `-filter_complex "` +
    `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black[bg];` +
    `[1:v]scale=240:-1[avatar];` +
    `[bg][avatar]overlay=W-w-20:H-h-20:shortest=1` +
    `" -map 1:a -c:v libx264 -c:a aac -b:a 128k -pix_fmt yuv420p -movflags +faststart -shortest "${outputPath}"`,
    { stdio: 'ignore', timeout: 30000 }
  );
  return outputPath;
}

async function compositeClipAsync(stepImagePath, avatarClipPath, outputPath) {
  await execAsync(
    `ffmpeg -y -loop 1 -i "${stepImagePath}" -i "${avatarClipPath}" ` +
    `-filter_complex "` +
    `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black[bg];` +
    `[1:v]scale=240:-1[avatar];` +
    `[bg][avatar]overlay=W-w-20:H-h-20:shortest=1` +
    `" -map 1:a -c:v libx264 -c:a aac -b:a 128k -pix_fmt yuv420p -movflags +faststart -shortest "${outputPath}"`,
    { timeout: 30000 }
  );
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
// PHASE 1: Research — Claude script + Serper images (parallel)
// ═══════════════════════════════════════════════════════════════
async function runResearch(topic, emit = () => {}) {
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const sessionDir = path.join(OUT_DIR, sessionId);
  const imgDir = path.join(sessionDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  const t0 = Date.now();
  emit('research:start', { sessionId, topic });

  // 1. Claude generates script
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

  let pipelineResults;

  if (SKIP_AVATAR) {
    // ── DEV MODE: TTS + screenshot slideshow (no avatar, no VEED, no fal video calls) ──
    emit('avatar:start', {});
    emit('avatar:done', { skipped: true });
    console.log('[DEV] SKIP_AVATAR=true — generating slideshow clips (no VEED/avatar)');

    pipelineResults = await Promise.all(
      narrations.map(async (n) => {
        // TTS only
        let ttsFile;
        try {
          ttsFile = await generateTTS(n.text, path.join(audioDir, `${n.id}.wav`));
          emit('tts:done', { id: n.id });
        } catch (err) {
          emit('tts:error', { id: n.id, error: err.message });
          return null;
        }

        // Simple slideshow: screenshot + audio → mp4 with ffmpeg
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
  } else {
    // ── PRODUCTION: Full pipeline with avatar + VEED ──
    emit('avatar:start', {});
    const avatarPath = await getOrCreateAvatar();
    const avatarUrl = await uploadToFal(avatarPath, 'image/png');
    emit('avatar:done', { reused: true });

    pipelineResults = await Promise.all(
      narrations.map(async (n) => {
        // TTS
        let ttsFile;
        try {
          ttsFile = await generateTTS(n.text, path.join(audioDir, `${n.id}.wav`));
          emit('tts:done', { id: n.id });
        } catch (err) {
          emit('tts:error', { id: n.id, error: err.message });
          return null;
        }

        // VEED talking clip
        let avatarClipFile;
        try {
          avatarClipFile = await generateTalkingClip(avatarUrl, ttsFile, path.join(vidDir, `avatar-${n.id}.mp4`), emit, n.id);
        } catch (err) {
          emit('video:clip:error', { label: n.id, error: err.message });
          return null;
        }

        // Composite: screenshot bg + avatar PiP
        const compositeFile = path.join(vidDir, `${n.id}.mp4`);
        let bgImage = null;
        if (n.id === 'intro') bgImage = steps[0]?.screenshot ? path.join(imgDir, steps[0].screenshot) : null;
        else if (n.id === 'outro') bgImage = steps[steps.length - 1]?.screenshot ? path.join(imgDir, steps[steps.length - 1].screenshot) : null;
        else {
          const idx = parseInt(n.id.split('-')[1]) - 1;
          bgImage = steps[idx]?.screenshot ? path.join(imgDir, steps[idx].screenshot) : null;
        }

        if (bgImage && fs.existsSync(bgImage)) {
          try {
            await compositeClipAsync(bgImage, avatarClipFile, compositeFile);
            emit('video:composite:done', { label: n.id });
            return compositeFile;
          } catch {
            return avatarClipFile;
          }
        }
        return avatarClipFile;
      })
    );
  }

  const compositeClips = pipelineResults.filter(Boolean);
  emit('tts:complete', { success: compositeClips.length, time: Date.now() - t0 });
  emit('video:clips:done', { success: compositeClips.length, total: narrations.length, time: Date.now() - t0 });

  // 5. Concatenate → final video
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
