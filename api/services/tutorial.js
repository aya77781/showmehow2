const Anthropic = require('@anthropic-ai/sdk');
const { fal } = require('@fal-ai/client');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();
if (process.env.FAL_KEY) {
  fal.config({ credentials: process.env.FAL_KEY });
}

const OUT_DIR = path.resolve(__dirname, '..', 'output', 'sessions');
const ASSETS_DIR = path.resolve(__dirname, '..', 'assets');

// ═══════════════════════════════════════════════════════════════
// Avatar — generate once with FLUX, reuse for all videos
// ═══════════════════════════════════════════════════════════════
async function getOrCreateAvatar() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const avatarPath = path.join(ASSETS_DIR, 'avatar.png');
  if (fs.existsSync(avatarPath)) return avatarPath;

  const result = await fal.subscribe('fal-ai/flux/dev', {
    input: {
      prompt: 'Professional young woman, late 20s, friendly warm smile, looking directly at camera, shoulders up headshot portrait, solid light gray background, studio lighting, photorealistic, high quality',
      image_size: { width: 512, height: 512 },
      num_images: 1,
    },
  });
  const imageUrl = result.data?.images?.[0]?.url;
  if (!imageUrl) throw new Error('Failed to generate avatar');
  const res = await fetch(imageUrl);
  fs.writeFileSync(avatarPath, Buffer.from(await res.arrayBuffer()));
  return avatarPath;
}

async function uploadToFal(filePath, mimeType) {
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer], { type: mimeType });
  return await fal.storage.upload(blob);
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
- imageQuery must be ULTRA-SPECIFIC: "[SiteName] [exact page name] [exact UI element] screenshot interface"
  Example: "GitHub new repository page name input field screenshot"
  Example: "Gmail compose window subject line text field screenshot"
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
// Serper image search → save ALL candidates, Claude picks best
// ═══════════════════════════════════════════════════════════════
async function fetchStepImages(step, imgDir, emit) {
  const stepNum = String(step.step).padStart(2, '0');
  const query = step.imageQuery || `${step.title} screenshot interface`;
  emit('screenshot:search', { step: step.step, query });

  const res = await fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, gl: 'us', hl: 'en', num: 10 }),
  });

  if (!res.ok) return false;
  const data = await res.json();
  const images = (data.images || []).slice(0, 10);

  // Download ALL in parallel
  const downloads = await Promise.allSettled(
    images.map(img =>
      fetch(img.imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(4000),
      }).then(async r => {
        if (!r.ok) throw new Error('not ok');
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 5000) throw new Error('too small');
        return buf;
      })
    )
  );

  const candidates = downloads
    .filter(d => d.status === 'fulfilled')
    .map(d => d.value)
    .filter(buf => {
      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50;
      return isJpeg || isPng;
    })
    .slice(0, 6);

  if (candidates.length === 0) return false;

  // Save ALL candidates as step-01-c1.jpg, step-01-c2.jpg, etc.
  const candidateFiles = [];
  candidates.forEach((buf, i) => {
    const ext = buf[0] === 0x89 ? 'png' : 'jpg';
    const file = `step-${stepNum}-c${i + 1}.${ext}`;
    fs.writeFileSync(path.join(imgDir, file), buf);
    candidateFiles.push(file);
  });

  // Claude Vision picks the BEST image
  let picked = 0;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: [
          ...candidates.map(buf => ({
            type: 'image',
            source: { type: 'base64', media_type: detectMime(buf), data: buf.toString('base64') },
          })),
          {
            type: 'text',
            text: `Tutorial step: "${step.title}" — ${step.description || ''}

Pick the image that BEST shows this step. It MUST be:
1. A real screenshot of the correct website/app (not illustration, not icon, not blog)
2. Showing the EXACT page/screen described (not homepage if step is about settings)
3. Clear, readable, not cropped or blurry

Reply ONLY with the number (1-${candidates.length}), or 0 if none match.`,
          },
        ],
      }],
    });

    const numMatch = response.content[0].text.trim().match(/\d+/);
    const choice = numMatch ? parseInt(numMatch[0]) - 1 : 0;
    picked = (choice >= 0 && choice < candidates.length) ? choice : 0;
  } catch {}

  // Copy the picked candidate as the main screenshot
  const mainFile = `step-${stepNum}.png`;
  fs.copyFileSync(path.join(imgDir, candidateFiles[picked]), path.join(imgDir, mainFile));

  step.screenshot = mainFile;
  step.candidates = candidateFiles;
  step.picked = picked;

  emit('screenshot:done', {
    step: step.step,
    picked: picked + 1,
    total: candidates.length,
    candidates: candidateFiles,
  });
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Final Claude pass — discard out-of-context candidates
// ═══════════════════════════════════════════════════════════════
async function validateCandidates(steps, imgDir, emit) {
  const stepsWithCandidates = steps.filter(s => s.candidates?.length > 0);
  if (stepsWithCandidates.length === 0) return;

  emit('validation:start', { total: stepsWithCandidates.length });

  // Validate each step's candidates in parallel
  await Promise.all(stepsWithCandidates.map(async (step) => {
    const stepNum = String(step.step).padStart(2, '0');
    const bufs = step.candidates.map(f => fs.readFileSync(path.join(imgDir, f)));

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: [
            ...bufs.map(buf => ({
              type: 'image',
              source: { type: 'base64', media_type: detectMime(buf), data: buf.toString('base64') },
            })),
            {
              type: 'text',
              text: `Tutorial step: "${step.title}" — ${step.description || ''}

You see ${bufs.length} candidate images. Which ones are RELEVANT to this tutorial step?
A relevant image must be a real screenshot/UI of the correct website/app showing the described action.
Discard: illustrations, icons, unrelated pages, blog posts, marketing images.

Reply with ONLY the numbers of RELEVANT images, comma-separated. Example: 1,3,5
If NONE are relevant, reply: NONE`,
            },
          ],
        }],
      });

      const text = response.content[0].text.trim();
      if (text === 'NONE') {
        step.validCandidates = [];
      } else {
        const nums = text.match(/\d+/g)?.map(n => parseInt(n) - 1).filter(n => n >= 0 && n < step.candidates.length) || [];
        step.validCandidates = nums.map(n => step.candidates[n]);
        // If picked candidate was discarded, re-pick from valid ones
        if (step.validCandidates.length > 0 && !step.validCandidates.includes(step.candidates[step.picked])) {
          const newPicked = step.candidates.indexOf(step.validCandidates[0]);
          step.picked = newPicked;
          const mainFile = `step-${stepNum}.png`;
          fs.copyFileSync(path.join(imgDir, step.validCandidates[0]), path.join(imgDir, mainFile));
          step.screenshot = mainFile;
        }
      }
    } catch {
      step.validCandidates = step.candidates; // keep all on error
    }

    emit('validation:step', { step: step.step, valid: step.validCandidates?.length || 0, total: step.candidates.length });
  }));

  emit('validation:done', {});
}

// ═══════════════════════════════════════════════════════════════
// Fetch ALL step images in parallel
// ═══════════════════════════════════════════════════════════════
async function fetchAllImages(steps, imgDir, emit = () => {}) {
  emit('research:screenshots:start', { total: steps.length });

  const results = await Promise.all(
    steps.map(step => fetchStepImages(step, imgDir, emit))
  );

  const count = results.filter(Boolean).length;
  emit('research:screenshots:done', { count });

  // Final Claude pass to discard out-of-context images
  await validateCandidates(steps, imgDir, emit);

  return count;
}

// ═══════════════════════════════════════════════════════════════
// TTS — xAI via fal.ai
// ═══════════════════════════════════════════════════════════════
async function generateTTS(text, outputPath) {
  const result = await fal.subscribe('xai/tts/v1', {
    input: { text: text.replace(/<[^>]+>/g, ''), voice: 'rex', language: 'en' },
  });
  const audioUrl = result.data?.audio?.url;
  if (!audioUrl) throw new Error('No audio from TTS');
  const res = await fetch(audioUrl);
  fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
  return outputPath;
}

// ═══════════════════════════════════════════════════════════════
// VEED Fabric 1.0 — avatar + audio → talking head
// ═══════════════════════════════════════════════════════════════
async function generateTalkingClip(avatarUrl, audioPath, outputPath, emit, label) {
  const audioUrl = await uploadToFal(audioPath, 'audio/wav');
  emit('video:clip:progress', { label, status: 'GENERATING' });

  const result = await fal.subscribe('veed/fabric-1.0', {
    input: { image_url: avatarUrl, audio_url: audioUrl, resolution: '480p' },
    onQueueUpdate(update) {
      emit('video:clip:progress', { label, status: update.status, position: update.position || null });
    },
  });

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
  const imgCount = await fetchAllImages(tutorial.steps, imgDir, emit);

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

  // 1. Avatar
  emit('avatar:start', {});
  const avatarPath = await getOrCreateAvatar();
  const avatarUrl = await uploadToFal(avatarPath, 'image/png');
  emit('avatar:done', { reused: true });

  // 2. TTS — all parallel
  const narrations = [
    { text: intro, id: 'intro' },
    ...steps.map((s, i) => ({ text: s.description || s.title, id: `step-${i + 1}` })),
    { text: outro, id: 'outro' },
  ];
  emit('tts:start', { total: narrations.length });
  const ttsResults = await Promise.all(
    narrations.map(n =>
      generateTTS(n.text, path.join(audioDir, `${n.id}.wav`))
        .then(f => { emit('tts:done', { id: n.id }); return f; })
        .catch(err => { emit('tts:error', { id: n.id, error: err.message }); return null; })
    )
  );
  emit('tts:complete', { success: ttsResults.filter(Boolean).length, time: Date.now() - t0 });

  // 3. VEED talking clips — all parallel
  emit('video:start', { total: narrations.length });
  const avatarClips = await Promise.all(
    narrations.map((n, i) => {
      if (!ttsResults[i]) return null;
      const clipFile = path.join(vidDir, `avatar-${n.id}.mp4`);
      return generateTalkingClip(avatarUrl, ttsResults[i], clipFile, emit, n.id)
        .catch(err => { emit('video:clip:error', { label: n.id, error: err.message }); return null; });
    })
  );
  emit('video:clips:done', { success: avatarClips.filter(Boolean).length, total: narrations.length, time: Date.now() - t0 });

  // 4. Composite: screenshot bg + avatar PiP
  emit('video:compositing', { total: narrations.length });
  const imgDir = path.join(sessionDir, 'images');
  const compositeClips = [];

  for (let i = 0; i < narrations.length; i++) {
    const n = narrations[i];
    const avatarClipFile = avatarClips[i];
    if (!avatarClipFile) continue;

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
        compositeClip(bgImage, avatarClipFile, compositeFile);
        compositeClips.push(compositeFile);
        emit('video:composite:done', { label: n.id });
      } catch {
        compositeClips.push(avatarClipFile);
      }
    } else {
      compositeClips.push(avatarClipFile);
    }
  }

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
