const Anthropic = require('@anthropic-ai/sdk');
const { fal } = require('@fal-ai/client');
const { chromium } = require('playwright');
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
// Claude → tutorial script with real URLs per step
// ═══════════════════════════════════════════════════════════════
async function generateScript(topic) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{
      role: 'user',
      content: `You are a tutorial script writer. Create a step-by-step video tutorial for: "${topic}"

RULES:
- Use web_search to find the EXACT current URLs for each step
- 5-7 steps maximum — no filler steps
- Each description must be a complete spoken sentence (15-25 words), not a fragment
- imageQuery must be highly specific: include site name + exact UI element + "interface" (e.g. "GitHub create repository form green button interface 2024")
- URLs must be the EXACT page where the action happens, not the homepage
- Never repeat the same URL twice unless unavoidable

Return ONLY valid JSON, no markdown, no explanation:
{
  "title": "How to...",
  "url": "https://...",
  "intro": "Welcome! Today I'll show you exactly how to [topic] in just [N] simple steps.",
  "outro": "And that's it! You've successfully [completed topic]. Don't forget to like and subscribe.",
  "steps": [
    {
      "step": 1,
      "title": "Short action verb + object",
      "description": "Full spoken sentence describing what the viewer sees and does on screen.",
      "url": "https://exact-page.com/path",
      "imageQuery": "SiteName specific UI element action interface screenshot"
    }
  ]
}`
    }]
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
  const i = text.indexOf('{'), j = text.lastIndexOf('}');
  if (i === -1) throw new Error('No JSON from Claude');
  const script = JSON.parse(text.slice(i, j + 1));
  // Strip <cite> tags
  if (script.steps) {
    script.steps.forEach(s => {
      if (s.description) s.description = s.description.replace(/<[^>]+>/g, '').trim();
    });
  }
  if (script.intro) script.intro = script.intro.replace(/<[^>]+>/g, '').trim();
  if (script.outro) script.outro = script.outro.replace(/<[^>]+>/g, '').trim();
  return script;
}

// ═══════════════════════════════════════════════════════════════
// Extract simplified HTML from page (inputs, buttons, links, forms)
// ═══════════════════════════════════════════════════════════════
async function extractPageStructure(page) {
  return await page.evaluate(() => {
    const elements = [];
    // Inputs
    document.querySelectorAll('input, textarea, select').forEach(el => {
      if (el.offsetParent === null) return; // hidden
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      elements.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        name: el.name || '',
        id: el.id || '',
        placeholder: el.placeholder || '',
        label: el.labels?.[0]?.textContent?.trim() || '',
        value: el.value || '',
        selector: el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : null,
      });
    });
    // Buttons and links
    document.querySelectorAll('button, a[href], [role="button"]').forEach(el => {
      if (el.offsetParent === null) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const text = el.textContent?.trim().slice(0, 60);
      if (!text) return;
      elements.push({
        tag: el.tagName.toLowerCase(),
        text,
        href: el.href || '',
        id: el.id || '',
        class: el.className?.toString().slice(0, 80) || '',
        selector: el.id ? `#${el.id}` : null,
      });
    });
    // Checkboxes and radios
    document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(el => {
      if (el.offsetParent === null) return;
      const label = el.labels?.[0]?.textContent?.trim() || el.name || '';
      elements.push({
        tag: 'checkbox',
        name: el.name || '',
        id: el.id || '',
        label,
        checked: el.checked,
        selector: el.id ? `#${el.id}` : `[name="${el.name}"]`,
      });
    });
    return { title: document.title, url: location.href, elements: elements.slice(0, 50) };
  });
}

// ═══════════════════════════════════════════════════════════════
// Claude analyzes real HTML → returns Playwright actions
// ═══════════════════════════════════════════════════════════════
async function getActionsFromHTML(pageStructure, stepTitle, stepDescription) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Browser automation task. You MUST only use selectors from the elements list below.

PAGE: "${pageStructure.title}"
URL: ${pageStructure.url}
STEP GOAL: "${stepTitle}" — ${stepDescription}

AVAILABLE ELEMENTS (use ONLY these selectors):
${JSON.stringify(pageStructure.elements, null, 2)}

DECISION:
1. If the page already shows what the step describes → return []
2. If interaction is needed → return 1-3 actions max using ONLY selectors from above

ACTION FORMAT (return JSON array only, no explanation):
[{"action":"fill","selector":"#id","value":"fake-data"},{"action":"click","selector":"#btn"}]

FAKE DATA RULES:
- email → "alex.demo@example.com"
- password → "Demo@Pass123"
- username → "alexdemo2024"
- repo/project name → "my-awesome-project"
- full name → "Alex Demo"
- phone → "+1 555 0100"

IMPORTANT: If a selector from elements has id, ALWAYS prefer #id over other selectors.
If no matching selector exists for the action, skip that action entirely.
Return [] if the page is a landing/info page with nothing to fill.`
    }]
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
  const i = text.indexOf('['), j = text.lastIndexOf(']');
  if (i === -1) return [];
  try {
    return JSON.parse(text.slice(i, j + 1));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// Execute Playwright actions from Claude
// ═══════════════════════════════════════════════════════════════
async function executeActions(page, actions, emit, stepNum) {
  for (const act of actions) {
    try {
      switch (act.action) {
        case 'fill':
          await page.waitForSelector(act.selector, { timeout: 3000 }).catch(() => {});
          await page.fill(act.selector, act.value || '');
          await page.waitForTimeout(400);
          emit('step:action', { step: stepNum, action: 'fill', selector: act.selector });
          break;
        case 'click':
          await page.waitForSelector(act.selector, { timeout: 3000 }).catch(() => {});
          await page.click(act.selector);
          await page.waitForTimeout(800);
          emit('step:action', { step: stepNum, action: 'click', selector: act.selector });
          break;
        case 'check':
          await page.waitForSelector(act.selector, { timeout: 3000 }).catch(() => {});
          await page.check(act.selector);
          await page.waitForTimeout(400);
          emit('step:action', { step: stepNum, action: 'check', selector: act.selector });
          break;
        case 'select':
          await page.selectOption(act.selector, act.value || '');
          await page.waitForTimeout(400);
          break;
        case 'scroll':
          await page.evaluate((px) => window.scrollBy(0, px), act.pixels || 300);
          await page.waitForTimeout(400);
          break;
        case 'wait':
          await page.waitForTimeout(act.ms || 1000);
          break;
      }
    } catch (err) {
      emit('step:action-error', { step: stepNum, action: act.action, selector: act.selector, error: err.message });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Dismiss cookie banners
// ═══════════════════════════════════════════════════════════════
async function dismissCookies(page) {
  const selectors = [
    'button[id*="accept"]', 'button[id*="Accept"]',
    'button[id*="agree"]', 'button[id*="consent"]',
    'button[id="L2AGLb"]',
    'button[aria-label="Accept all"]',
    '#onetrust-accept-btn-handler',
    '.cc-accept', '.cc-btn.cc-allow',
  ];
  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(1000);
        return true;
      }
    } catch {}
  }
  // Fallback: any button with accept/agree text
  try {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = (await btn.textContent() || '').toLowerCase();
      if (text.includes('accept') || text.includes('agree') || text.includes('got it') || text.includes('i agree')) {
        if (await btn.isVisible()) { await btn.click(); await page.waitForTimeout(1000); return true; }
      }
    }
  } catch {}
  return false;
}

// ═══════════════════════════════════════════════════════════════
// Detect if page is a login/auth wall
// ═══════════════════════════════════════════════════════════════
async function isLoginWall(page) {
  const title = (await page.title()).toLowerCase();
  const url = page.url().toLowerCase();
  const loginKeywords = ['sign in', 'log in', 'login', 'signin', 'authenticate', 'sso', 'oauth', 'password'];
  return loginKeywords.some(k => title.includes(k) || url.includes(k));
}

// ═══════════════════════════════════════════════════════════════
// Fallback: search Google Images via Serper, Claude validates best match
// ═══════════════════════════════════════════════════════════════
async function searchAndDownloadImage(query, filePath, stepTitle, stepDescription) {
  const res = await fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query + ' screenshot UI', gl: 'us', hl: 'en', num: 10 }),
  });

  if (!res.ok) return false;
  const data = await res.json();
  const images = (data.images || []).slice(0, 8);

  // Download ALL successful images in parallel
  const downloads = await Promise.allSettled(
    images.map(img =>
      fetch(img.imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(4000),
      })
      .then(async r => {
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
    .slice(0, 5); // max 5 for Claude to evaluate

  if (candidates.length === 0) return false;
  if (candidates.length === 1) {
    fs.writeFileSync(filePath, candidates[0]);
    return true;
  }

  // Claude Vision picks the best image for this step
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          ...candidates.map(buf => ({
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') },
          })),
          {
            type: 'text',
            text: `Tutorial step: "${stepTitle || ''}" — ${stepDescription || ''}
Search query: "${query}"

You see ${candidates.length} images from Google Image search.
Pick the ONE image that BEST matches this tutorial step.

CRITERIA (in order of importance):
1. Shows the CORRECT website/app interface (not a different site)
2. Shows the EXACT screen/page described in the step (not a different page)
3. Is a real screenshot of the UI (not a blog thumbnail, icon, or illustration)
4. Is clear and readable (not blurry, cropped, or too small)

If NONE of the images match the step well, reply: 0
Otherwise reply with ONLY the image number: 1, 2, 3, 4, or 5`,
          },
        ],
      }],
    });

    const choice = parseInt(response.content[0].text.trim()) - 1;
    if (choice >= 0 && choice < candidates.length) {
      fs.writeFileSync(filePath, candidates[choice]);
      return true;
    } else if (choice === -1) {
      // Claude said 0 = none match, save best available anyway
      fs.writeFileSync(filePath, candidates[0]);
      return true;
    }
  } catch {}

  fs.writeFileSync(filePath, candidates[0]);
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Best shot — 4 screenshots at different moments, Claude validates
// ═══════════════════════════════════════════════════════════════
async function captureBestShot(page, filePath, stepTitle, stepDescription) {
  const candidates = [];
  for (const delay of [0, 600, 1200, 2000]) {
    if (delay > 0) await page.waitForTimeout(delay);
    const buf = await page.screenshot({ type: 'jpeg', quality: 65 });
    candidates.push(buf);
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: [
        ...candidates.map(buf => ({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') },
        })),
        {
          type: 'text',
          text: `Tutorial step: "${stepTitle}" — ${stepDescription}

These are 4 screenshots of the SAME page taken at t=0s, t=0.6s, t=1.2s, and t=2s.

PICK the best screenshot. Criteria:
1. Page is FULLY LOADED (no spinners, no skeleton loaders, no blank areas)
2. The UI elements described in the step are VISIBLE on screen
3. Any form fields that were filled have the data visible
4. No popups, overlays, or cookie banners blocking the content

Reply with ONLY the number: 1, 2, 3, or 4`,
        },
      ],
    }],
  });

  const choice = parseInt(response.content[0].text.trim()) - 1;
  const bestIndex = (choice >= 0 && choice < candidates.length) ? choice : candidates.length - 1;
  // Save the chosen JPEG (already good quality for video)
  fs.writeFileSync(filePath, candidates[bestIndex]);
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Navigate + extract HTML + Claude actions + best screenshot
// Fallback: if login wall or error, search for image online
// ═══════════════════════════════════════════════════════════════
async function captureScreenshots(steps, imgDir, emit = () => {}) {
  const browser = await chromium.launch({ headless: true, args: ['--lang=en-US'] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  const page = await context.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  let count = 0;
  let lastUrl = '';

  for (const step of steps) {
    const stepNum = String(step.step).padStart(2, '0');
    const file = `step-${stepNum}.png`;
    const filePath = path.join(imgDir, file);

    try {
      emit('screenshot:step', { step: step.step, title: step.title, url: step.url });

      // Navigate only if URL changed
      const url = step.url || '';
      if (url && url !== lastUrl && !url.includes('[')) {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 12000 })
          .catch(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 }));
        lastUrl = page.url();
        await dismissCookies(page);
      }

      // Login wall → fallback to image search
      if (await isLoginWall(page)) {
        emit('screenshot:login-detected', { step: step.step, url: page.url() });

        // If this step IS about signing in, fill form + screenshot
        if (step.title.toLowerCase().includes('sign') || step.title.toLowerCase().includes('log in')) {
          const structure = await extractPageStructure(page);
          const actions = await getActionsFromHTML(structure, step.title, step.description || '');
          if (actions.length) await executeActions(page, actions, emit, step.step);
          await captureBestShot(page, filePath, step.title, step.description || '');
          step.screenshot = file;
          count++;
          emit('screenshot:done', { step: step.step, file });
        } else {
          // Not a login step — search for image
          const query = step.imageQuery || `${step.title} screenshot`;
          emit('screenshot:fallback-search', { step: step.step, query });
          const found = await searchAndDownloadImage(query, filePath, step.title, step.description || '');
          if (found) { step.screenshot = file; count++; }
          emit('screenshot:done', { step: step.step, file, source: 'image-search' });
        }
        continue;
      }

      // Normal flow: extract HTML → Claude maps actions → execute → best shot
      const structure = await extractPageStructure(page);
      emit('screenshot:html', { step: step.step, title: structure.title, elements: structure.elements.length });

      const actions = await getActionsFromHTML(structure, step.title, step.description || '');
      emit('screenshot:actions', { step: step.step, count: actions.length, actions: actions.map(a => a.action) });
      if (actions.length) await executeActions(page, actions, emit, step.step);

      // Claude picks the best of 4 screenshots
      await captureBestShot(page, filePath, step.title, step.description || '');
      step.screenshot = file;
      count++;
      emit('screenshot:done', { step: step.step, file });

    } catch {
      // Fallback: Serper image search — Claude validates
      const query = step.imageQuery || `${step.title} screenshot`;
      const found = await searchAndDownloadImage(query, filePath, step.title, step.description || '');
      if (found) { step.screenshot = file; count++; }
      emit('screenshot:fallback', { step: step.step, source: 'image-search' });
    }
  }

  await browser.close();
  return count;
}

// ═══════════════════════════════════════════════════════════════
// TTS — ElevenLabs (Sarah, female, american)
// ═══════════════════════════════════════════════════════════════
const ELEVENLABS_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Sarah

async function generateTTS(text, outputPath) {
  const cleanText = text.replace(/<[^>]+>/g, '').trim();
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: cleanText,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${err}`);
  }
  fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
  return outputPath;
}

// ═══════════════════════════════════════════════════════════════
// VEED Fabric 1.0 — avatar + audio → talking head
// ═══════════════════════════════════════════════════════════════
async function generateTalkingClip(avatarUrl, audioPath, outputPath, emit, label) {
  const audioUrl = await uploadToFal(audioPath, 'audio/mpeg');
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
// PHASE 1: Research — Claude script + Playwright screenshots
// ═══════════════════════════════════════════════════════════════
async function runResearch(topic, emit = () => {}) {
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const sessionDir = path.join(OUT_DIR, sessionId);
  const imgDir = path.join(sessionDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  const t0 = Date.now();
  emit('research:start', { sessionId, topic });

  // 1. Claude generates script with real URLs via web search
  emit('research:claude:start', {});
  const tutorial = await generateScript(topic);
  emit('research:claude:done', {
    steps: tutorial.steps, intro: tutorial.intro, outro: tutorial.outro, time: Date.now() - t0,
  });

  // 2. Playwright navigates → extracts HTML → Claude maps actions → executes → screenshots
  emit('research:screenshots:start', { total: tutorial.steps.length });
  const imgCount = await captureScreenshots(tutorial.steps, imgDir, emit);
  emit('research:screenshots:done', { count: imgCount, time: Date.now() - t0 });

  tutorial.source = 'Playwright + Claude';
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
  const intro = tutorial.intro || `Welcome to this tutorial: ${tutorial.title}`;
  const outro = tutorial.outro || `That's it! You've completed the tutorial successfully.`;

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
      generateTTS(n.text, path.join(audioDir, `${n.id}.mp3`))
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
