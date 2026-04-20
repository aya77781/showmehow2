const OpenAI = require('openai');
const { execSync, exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Spawn-based ffmpeg runner so we pass args as an array (avoids Windows shell
// escaping issues on paths with spaces/backslashes).
function runFFmpeg(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = timeoutMs ? setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      reject(new Error(`ffmpeg timeout after ${timeoutMs}ms`));
    }, timeoutMs) : null;
    proc.on('error', (err) => { if (timer) clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-300)}`));
    });
  });
}

async function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ]);
    let output = '';
    ffprobe.stdout.on('data', (d) => { output += d; });
    ffprobe.on('error', reject);
    ffprobe.on('close', (code) => {
      if (code === 0) {
        const v = parseFloat(output.trim());
        if (Number.isFinite(v) && v > 0) return resolve(v);
        return reject(new Error(`ffprobe returned invalid duration: ${output}`));
      }
      reject(new Error('ffprobe failed with code ' + code));
    });
  });
}
const fs = require('fs');
const path = require('path');
const { normalize, hashKey, cacheGet, cacheSet } = require('./cache');
const { generateAllSlides } = require('./slideGenerator');
const { scrapeForTopic } = require('./scraper');
const projects = require('../db/projects');

const client = new OpenAI();
const TEXT_MODEL = 'gpt-4o-mini';

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
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.75,
            similarity_boost: 0.5,
            style: 0.0,
            use_speaker_boost: true,
          },
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
// GPT → tutorial script (cached by normalized topic)
// ═══════════════════════════════════════════════════════════════
async function generateScript(topic) {
  const cacheKey = normalize(topic);
  const cached = await cacheGet('script', cacheKey);
  if (cached) return cached.value;

  const response = await client.chat.completions.create({
    model: TEXT_MODEL,
    max_tokens: 2048,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `You are a tutorial script writer for SHORT video tutorials. Create a step-by-step tutorial for: "${topic}"

RULES:
- Identify the real website/app/tool for this topic from your knowledge
- 8-12 steps — each step is ONE micro-action (click one button, run one command, fill one field, etc.)
- Each description must be EXACTLY 5-10 words — short enough for a 2-second voiceover
- Each step MUST include a "command" field (a short literal command, shell invocation, or UI action label)
- Each step MUST include an "explanation" field (a 1-sentence rationale, 8-20 words)
- Steps should show DIFFERENT actions / screens / sections

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
      "command": "literal command or UI action",
      "explanation": "Why this step matters in 1 sentence."
    }
  ]
}`
    }]
  });

  const text = response.choices[0].message.content || '';
  const i = text.indexOf('{'), j = text.lastIndexOf('}');
  if (i === -1) throw new Error('No JSON from model');
  const script = JSON.parse(text.slice(i, j + 1));
  const strip = s => s ? s.replace(/<[^>]+>/g, '').trim() : s;
  if (script.steps) script.steps.forEach(s => { s.description = strip(s.description); });
  script.intro = strip(script.intro);
  script.outro = strip(script.outro);

  await cacheSet('script', cacheKey, script, null, 7);
  return script;
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

async function concatenateVideos(clipPaths, outputPath) {
  const listFile = outputPath.replace('.mp4', '-list.txt');
  // Use forward slashes inside the list file for reliability on Windows ffmpeg.
  const listBody = clipPaths
    .map((p) => `file '${p.replace(/\\/g, '/')}'`)
    .join('\n');
  fs.writeFileSync(listFile, listBody);
  try {
    await runFFmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-r', '24',
      '-movflags', '+faststart',
      outputPath,
    ], 180000);
  } finally {
    try { fs.unlinkSync(listFile); } catch {}
  }
  return outputPath;
}

// Build ffmpeg args for a single image+audio clip, with a ShowMeHow watermark
// overlaid top-right. Uses api/assets/logo.png if present; otherwise falls
// back to drawtext so the pipeline never depends on the logo being there.
const LOGO_PATH = path.resolve(__dirname, '..', 'assets', 'logo.jpeg');

function buildClipArgs({ bgImage, ttsFile, clipFile, paddedDuration }) {
  const common = [
    '-c:v', 'libx264',
    '-tune', 'stillimage',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-pix_fmt', 'yuv420p',
    '-t', paddedDuration.toFixed(3),
    '-r', '24',
    '-shortest',
    clipFile,
  ];

  // Base scale+pad must produce strictly even dims; filter_complex (multi-
  // input) is stricter about this than -vf and libx264 rejects odd heights.
  const bgFilter = '[0:v]scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1';

  if (fs.existsSync(LOGO_PATH)) {
    return [
      '-y',
      '-loop', '1',
      '-i', bgImage,
      '-i', ttsFile,
      '-i', LOGO_PATH,
      '-filter_complex',
        `${bgFilter}[bg];[2:v]scale=320:-2[logo];[bg][logo]overlay=W-w:H-h[v]`,
      '-map', '[v]', '-map', '1:a',
      ...common,
    ];
  }

  // Drawtext fallback. Windows gets an explicit font path; other platforms
  // use ffmpeg's default font (fontconfig).
  const drawtextBase = 'drawtext=text=ShowMeHow:fontcolor=white:fontsize=48:x=W-tw:y=H-th:box=1:boxcolor=black@0.4:boxborderw=12';
  const drawtext = process.platform === 'win32'
    ? drawtextBase + ':fontfile=/Windows/Fonts/arial.ttf'
    : drawtextBase;

  return [
    '-y',
    '-loop', '1',
    '-i', bgImage,
    '-i', ttsFile,
    '-filter_complex',
      `${bgFilter},${drawtext}[v]`,
    '-map', '[v]', '-map', '1:a',
    ...common,
  ];
}

// Run async fn across items in batches of N (avoids overloading Windows with
// too many concurrent ffmpeg processes).
async function runInBatches(items, batchSize, fn) {
  const results = [];
  const totalBatches = Math.ceil(items.length / batchSize);
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    const batchNum = Math.floor(i / batchSize) + 1;
    console.log(`[FFmpeg] Batch ${batchNum}/${totalBatches} done`);
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// Strip scraper noise before TTS rewrite
// ═══════════════════════════════════════════════════════════════
function cleanStepText(text) {
  if (!text) return '';
  let t = text;

  // Inline bracket refs: [1], [2], [edit], [citation needed]
  t = t.replace(/\[[^\]]{1,30}\]/g, ' ');

  // WikiHow expert-source / attribution noise
  t = t.replace(/X\s+Expert Source[\s\S]*?(?=\.\s|$)/gi, ' ');
  t = t.replace(/X\s+Research source/gi, ' ');
  t = t.replace(/X\s+Trustworthy Source[\s\S]*?(?=\.\s|$)/gi, ' ');
  t = t.replace(/wikiHow Staff Editor/gi, ' ');
  t = t.replace(/Co-authored by[^.]*\./gi, ' ');
  t = t.replace(/Thanks!\s*Helpful[\s\S]*?Not Helpful[^.]*\.?/gi, ' ');
  t = t.replace(/Helpful\s+\d+\s+Not Helpful\s+\d+/gi, ' ');

  // Inline JS/tracking fragments that sometimes leak through
  t = t.replace(/WH\.performance\.[a-zA-Z]+\([^)]*\);?/g, ' ');
  t = t.replace(/\{"smallUrl":[\s\S]*?\}/g, ' ');

  // Collapse whitespace
  t = t.replace(/\s+/g, ' ').trim();

  // Drop sentence fragments shorter than 15 chars (likely noise)
  const sentences = t.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length >= 15);
  if (sentences.length > 0) t = sentences.join(' ');

  return t.trim();
}

// ═══════════════════════════════════════════════════════════════
// Rewrite raw scraped step text into natural TTS narration (cached)
// ═══════════════════════════════════════════════════════════════
async function rewriteNarration(text, topic = '') {
  const cleaned = cleanStepText(text);

  const cacheKey = hashKey(normalize(cleaned || text || '') + '|' + normalize(topic));
  const cached = await cacheGet('script', `narration:${cacheKey}`);
  if (cached && cached.value?.narration) return cached.value.narration;

  try {
    const res = await client.chat.completions.create({
      model: TEXT_MODEL,
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `Rewrite this tutorial step into natural spoken narration for a video voiceover.
Rules:
- 1 to 2 sentences maximum
- Conversational and clear, as if a friendly tutor is explaining
- Never start with "Step X", "First", or "Next"
- Present tense
- Return ONLY the narration text, no quotes, no preamble
- If the input text is unclear, incomplete, or seems like website noise (author bios, rating widgets, empty fragments), write a clean generic narration for a tutorial step about "${topic || 'the topic'}" instead.

Step text: "${(cleaned || text || '').slice(0, 600)}"`,
      }],
    });
    const narration = (res.choices[0].message.content || '').replace(/^["']|["']$/g, '').trim()
      || cleaned.slice(0, 180)
      || `Continue with the next step of ${topic || 'the tutorial'}.`;
    await cacheSet('script', `narration:${cacheKey}`, { narration }, null, 7);
    return narration;
  } catch (err) {
    console.warn(`[narration] rewrite failed: ${err.message}`);
    return cleaned.slice(0, 180) || `Continue with the next step of ${topic || 'the tutorial'}.`;
  }
}

function mapScrapedToTutorial(article, topic) {
  const steps = article.steps.map((s, i) => ({
    step: i + 1,
    stepNumber: s.index,
    title: s.imageAlt?.slice(0, 60) || `Step ${i + 1}`,
    description: s.text || '',
    command: '',
    explanation: '',
    screenshot: s.screenshot || null,
  }));
  return {
    title: article.title || `How to ${topic}`,
    url: article.url,
    intro: `Here's how to ${topic}.`,
    outro: `And that's it — you're all set.`,
    steps,
    source: `Scraped from ${article.source}`,
    sourceUrl: article.url,
  };
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1: Research — check for existing project first, then generate
// ═══════════════════════════════════════════════════════════════
async function runResearch(topic, emit = () => {}, preferredSource = null) {
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const sessionDir = path.join(OUT_DIR, sessionId);
  const imgDir = path.join(sessionDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  const t0 = Date.now();
  emit('research:start', { sessionId, topic });

  // ── Shortcut: check if a completed project with this topic exists ──
  const normalizedTopic = normalize(topic);
  try {
    const existing = await projects.findCompletedByNormalizedTopic(normalizedTopic);

    if (existing && existing.session_id) {
      const existingDir = path.join(OUT_DIR, existing.session_id, 'images');
      if (fs.existsSync(existingDir)) {
        const files = fs.readdirSync(existingDir);
        for (const f of files) {
          fs.copyFileSync(path.join(existingDir, f), path.join(imgDir, f));
        }
        const tutorial = existing.tutorial;
        emit('research:cached', { sessionId, originalSession: existing.session_id });
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

  // 1. Try scraping real tutorial articles first (WikiHow / HowToGeek / Lifewire)
  let tutorial = null;
  let imgCount = 0;
  let usedScraper = false;

  emit('scraper:source', { source: preferredSource || 'auto' });
  try {
    const scraped = await scrapeForTopic(topic, sessionId, emit, preferredSource);
    const validImages = scraped?.steps?.filter((s) => s.localImagePath).length || 0;

    if (scraped && validImages >= 3) {
      tutorial = mapScrapedToTutorial(scraped, topic);

      emit('research:claude:start', {});
      const narrations = await Promise.all(
        tutorial.steps.map((s) => rewriteNarration(s.description, topic))
      );
      narrations.forEach((n, i) => {
        if (n) tutorial.steps[i].description = n;
      });
      emit('research:claude:done', {
        steps: tutorial.steps, intro: tutorial.intro, outro: tutorial.outro, time: Date.now() - t0,
      });

      imgCount = validImages;
      usedScraper = true;
      emit('annotation:done', {});
    } else if (scraped) {
      emit('scraper:fallback', { reason: `only ${validImages} valid images (need 3+)` });
    } else {
      emit('scraper:fallback', { reason: 'no article found' });
    }
  } catch (err) {
    console.warn(`[Scraper Error] pipeline: ${err.message}`);
    emit('scraper:fallback', { reason: err.message });
  }

  // 2. Fallback: GPT script + AI-generated slides (original behavior)
  if (!usedScraper) {
    emit('research:claude:start', {});
    tutorial = await generateScript(topic);
    emit('research:claude:done', {
      steps: tutorial.steps, intro: tutorial.intro, outro: tutorial.outro, time: Date.now() - t0,
    });

    imgCount = await generateAllSlides(tutorial, topic, sessionDir, emit);
    tutorial.source = 'AI-generated slides';
  }

  const phase1Time = Date.now() - t0;
  const result = { sessionId, tutorial, stats: { images: imgCount, phase1Time, scraper: usedScraper } };
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

  const pipelineResults = await runInBatches(narrations, 4, async (n) => {
      let ttsFile;
      try {
        ttsFile = await generateTTS(n.text, path.join(audioDir, `${n.id}.wav`));
        emit('tts:done', { id: n.id });
      } catch (err) {
        emit('tts:error', { id: n.id, error: err.message });
        // Fallback: generate a silent WAV so the slide still renders as video
        try {
          ttsFile = path.join(audioDir, `${n.id}.wav`);
          const dur = Math.max(2, Math.min(12, Math.round((n.text || '').length * 0.08)));
          await execAsync(
            `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${dur} -c:a pcm_s16le "${ttsFile}"`,
            { timeout: 10000 }
          );
          emit('tts:fallback', { id: n.id, duration: dur });
        } catch (fallbackErr) {
          emit('tts:error', { id: n.id, error: 'fallback failed: ' + fallbackErr.message });
          return null;
        }
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
          // Exact duration from the audio file + 300ms padding ensures the clip
          // matches narration length precisely (no early cuts, no trailing black).
          let paddedDuration;
          try {
            const audioDur = await getAudioDuration(ttsFile);
            paddedDuration = audioDur + 0.3;
          } catch (probeErr) {
            console.warn(`[FFmpeg] ffprobe failed for ${n.id} (${probeErr.message}) — falling back to estimate`);
            paddedDuration = Math.max(2, Math.min(15, (n.text || '').length * 0.08)) + 0.3;
          }

          await runFFmpeg(buildClipArgs({ bgImage, ttsFile, clipFile, paddedDuration }), 45000);
          emit('video:clip:done', { label: n.id, file: path.basename(clipFile), size: fs.statSync(clipFile).size });
          return clipFile;
        } catch (err) {
          emit('video:clip:error', { label: n.id, error: err.message });
          return null;
        }
      }
      return null;
    });

  const compositeClips = pipelineResults.filter(Boolean);
  emit('tts:complete', { success: compositeClips.length, time: Date.now() - t0 });
  emit('video:clips:done', { success: compositeClips.length, total: narrations.length, time: Date.now() - t0 });

  const finalPath = path.join(sessionDir, 'final-video.mp4');

  // Safety check: only concat clips that actually exist and are non-empty.
  // Per-clip ffmpeg can fail silently (timeout, OOM, Windows quirks) — build
  // the concat list from the real filesystem state.
  const verifiedClips = compositeClips.filter((clipPath) => {
    if (!clipPath) return false;
    try {
      const st = fs.statSync(clipPath);
      if (st.size === 0) {
        console.warn(`[FFmpeg] Missing clip ${path.basename(clipPath)} — empty file, skipping`);
        return false;
      }
      return true;
    } catch {
      console.warn(`[FFmpeg] Missing clip ${path.basename(clipPath)} — not on disk, skipping`);
      return false;
    }
  });

  if (verifiedClips.length < compositeClips.length) {
    console.warn(`[FFmpeg] Concat list: ${verifiedClips.length}/${compositeClips.length} clips survived verification`);
  }

  if (verifiedClips.length > 0) {
    emit('video:concatenating', { clips: verifiedClips.length });
    try {
      await concatenateVideos(verifiedClips, finalPath);
      emit('video:final', { file: 'final-video.mp4', size: fs.statSync(finalPath).size, clips: verifiedClips.length });
    } catch (err) {
      emit('video:error', { error: 'Concat failed: ' + err.message });
    }
  } else {
    emit('video:error', { error: 'No usable clips to concatenate' });
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
