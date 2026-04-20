const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const puppeteer = require('puppeteer');
const { normalize, hashKey, cacheGet, cacheSet } = require('./cache');

const client = new OpenAI();
const SLIDE_MODEL = 'gpt-4o-mini';

const SLIDE_SYSTEM_PROMPT = `You are a technical slide generator. You output ONLY raw HTML. No markdown, no explanation, no backticks.

The slide is always 1280×720px, dark theme (#1a1b26 background), monospace font.
Layout: always two columns — left terminal panel (width:640px), right mockup panel (width:640px).
Bottom bar: always exactly 3 badges.

STRICT RULE: The right panel must ALWAYS contain real rendered HTML UI.
NEVER write placeholder text like [Mockup showing...] or descriptions.
NEVER leave the right panel empty.
ALWAYS render actual buttons, forms, file trees, terminal output — whatever fits the step.

You will receive a step and a TEMPLATE that shows the exact structure to follow.
Adapt the content of the template to match the step. Keep the same HTML structure.`;

const TEMPLATE_GIT = `<div style="width:1280px;height:720px;background:#1a1b26;display:grid;grid-template-columns:640px 640px;grid-template-rows:1fr 60px;font-family:monospace;overflow:hidden">
  <div style="background:#16161e;padding:28px;border-right:1px solid #2a2b3d;overflow:hidden">
    <div style="color:#565f89;font-size:12px;margin-bottom:20px;text-transform:uppercase;letter-spacing:0.08em">~/my-project</div>
    <div style="color:#565f89;font-size:14px;margin-bottom:8px">$ git init</div>
    <div style="color:#565f89;font-size:14px;margin-bottom:8px">$ git add .</div>
    <div style="color:#7dcfff;font-size:14px;margin-bottom:4px">$ git remote add origin https://github.com/user/my-project.git</div>
    <div style="color:#9ece6a;font-size:13px;margin-bottom:20px;padding-left:14px">origin set.</div>
    <div style="color:#7dcfff;font-size:15px;font-weight:bold;margin-bottom:4px">$ git push -u origin main</div>
    <div style="color:#9ece6a;font-size:13px;padding-left:14px">Branch 'main' tracking 'origin/main'.<br>1 commit pushed.</div>
  </div>
  <div style="background:#1e2030;padding:28px;overflow:hidden">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #2a2b3d">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#c0caf5"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
      <span style="color:#c0caf5;font-size:15px;font-weight:500">user / my-project</span>
      <span style="color:#9ece6a;font-size:11px;background:#1a2a1a;padding:2px 8px;border-radius:4px;margin-left:auto">Public</span>
    </div>
    <div style="display:flex;gap:20px;margin-bottom:16px">
      <span style="color:#565f89;font-size:13px">★ 0 stars</span>
      <span style="color:#565f89;font-size:13px">⑂ 0 forks</span>
      <span style="color:#565f89;font-size:13px">1 watching</span>
    </div>
    <div style="background:#16161e;border-radius:8px;padding:14px;margin-bottom:12px;border:1px solid #2a2b3d">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px">
        <span style="color:#9ece6a;font-size:12px;background:#1a2a1a;padding:2px 8px;border-radius:4px">main</span>
        <span style="color:#565f89;font-size:12px">1 commit</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;background:#1e2030;padding:10px 12px;border-radius:6px">
        <span style="color:#c0caf5;font-size:13px">initial commit</span>
        <span style="color:#565f89;font-size:12px">a1b2c3d · just now</span>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#16161e;border-radius:6px;border:1px solid #2a2b3d">
        <span style="color:#7dcfff;font-size:13px">README.md</span>
        <span style="color:#565f89;font-size:12px">initial commit</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#16161e;border-radius:6px;border:1px solid #2a2b3d">
        <span style="color:#7dcfff;font-size:13px">.gitignore</span>
        <span style="color:#565f89;font-size:12px">initial commit</span>
      </div>
    </div>
  </div>
  <div style="grid-column:1/-1;background:#16161e;border-top:1px solid #2a2b3d;display:flex;gap:12px;align-items:center;padding:0 28px">
    <div style="border-left:3px solid #7dcfff;padding:4px 10px"><span style="color:#7dcfff;font-size:11px">git push</span><span style="color:#565f89;font-size:11px"> → envoie les commits</span></div>
    <div style="border-left:3px solid #bb9af7;padding:4px 10px"><span style="color:#bb9af7;font-size:11px">-u flag</span><span style="color:#565f89;font-size:11px"> → set upstream tracking</span></div>
    <div style="border-left:3px solid #9ece6a;padding:4px 10px"><span style="color:#9ece6a;font-size:11px">origin/main</span><span style="color:#565f89;font-size:11px"> → branche distante</span></div>
  </div>
</div>`;

const TEMPLATE_DOCKER = `<div style="width:1280px;height:720px;background:#1a1b26;display:grid;grid-template-columns:640px 640px;grid-template-rows:1fr 60px;font-family:monospace;overflow:hidden">
  <div style="background:#16161e;padding:28px;border-right:1px solid #2a2b3d;overflow:hidden">
    <div style="color:#565f89;font-size:12px;margin-bottom:20px;text-transform:uppercase;letter-spacing:0.08em">bash</div>
    <div style="color:#565f89;font-size:14px;margin-bottom:8px">$ docker pull nginx</div>
    <div style="color:#565f89;font-size:13px;margin-bottom:16px;padding-left:14px">latest: Pulling from library/nginx<br>Status: Downloaded newer image</div>
    <div style="color:#7dcfff;font-size:15px;font-weight:bold;margin-bottom:4px">$ docker run -d -p 80:80 nginx</div>
    <div style="color:#9ece6a;font-size:13px;padding-left:14px;margin-bottom:16px">a3f2c1d4e5b6c7d8e9f0a1b2c3d4e5f6</div>
    <div style="color:#7dcfff;font-size:14px;margin-bottom:4px">$ docker ps</div>
    <div style="background:#1e2030;padding:10px;border-radius:4px;font-size:12px">
      <div style="color:#bb9af7;margin-bottom:4px">CONTAINER ID   IMAGE   STATUS</div>
      <div style="color:#9ece6a">a3f2c1d4e5b6   nginx   Up 3 seconds</div>
    </div>
  </div>
  <div style="background:#1e2030;padding:28px;overflow:hidden">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #2a2b3d">
      <div style="width:10px;height:10px;border-radius:50%;background:#9ece6a"></div>
      <span style="color:#c0caf5;font-size:14px;font-weight:500">Docker Desktop</span>
    </div>
    <div style="margin-bottom:8px;font-size:12px;color:#565f89;text-transform:uppercase">Containers running</div>
    <div style="background:#16161e;border-radius:8px;padding:14px;border:1px solid #2a2b3d;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="color:#c0caf5;font-size:14px">nginx</span>
        <span style="color:#9ece6a;font-size:11px;background:#1a2a1a;padding:2px 8px;border-radius:4px">Running</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="background:#1e2030;padding:8px;border-radius:4px">
          <div style="color:#565f89;font-size:11px">Port</div>
          <div style="color:#7dcfff;font-size:13px">0.0.0.0:80 → 80</div>
        </div>
        <div style="background:#1e2030;padding:8px;border-radius:4px">
          <div style="color:#565f89;font-size:11px">Image</div>
          <div style="color:#c0caf5;font-size:13px">nginx:latest</div>
        </div>
        <div style="background:#1e2030;padding:8px;border-radius:4px">
          <div style="color:#565f89;font-size:11px">CPU</div>
          <div style="color:#c0caf5;font-size:13px">0.02%</div>
        </div>
        <div style="background:#1e2030;padding:8px;border-radius:4px">
          <div style="color:#565f89;font-size:11px">Memory</div>
          <div style="color:#c0caf5;font-size:13px">12.4 MB</div>
        </div>
      </div>
    </div>
    <div style="background:#16161e;border-radius:8px;padding:12px;border:1px solid #2a2b3d">
      <div style="color:#565f89;font-size:11px;margin-bottom:6px">localhost:80</div>
      <div style="color:#9ece6a;font-size:13px">Welcome to nginx!</div>
      <div style="color:#565f89;font-size:12px">Server is running successfully.</div>
    </div>
  </div>
  <div style="grid-column:1/-1;background:#16161e;border-top:1px solid #2a2b3d;display:flex;gap:12px;align-items:center;padding:0 28px">
    <div style="border-left:3px solid #7dcfff;padding:4px 10px"><span style="color:#7dcfff;font-size:11px">-d flag</span><span style="color:#565f89;font-size:11px"> → detached mode (background)</span></div>
    <div style="border-left:3px solid #bb9af7;padding:4px 10px"><span style="color:#bb9af7;font-size:11px">-p 80:80</span><span style="color:#565f89;font-size:11px"> → host:container port map</span></div>
    <div style="border-left:3px solid #9ece6a;padding:4px 10px"><span style="color:#9ece6a;font-size:11px">docker ps</span><span style="color:#565f89;font-size:11px"> → liste les conteneurs actifs</span></div>
  </div>
</div>`;

const TEMPLATE_TERMINAL = `<div style="width:1280px;height:720px;background:#1a1b26;display:grid;grid-template-columns:640px 640px;grid-template-rows:1fr 60px;font-family:monospace;overflow:hidden">
  <div style="background:#16161e;padding:28px;border-right:1px solid #2a2b3d;overflow:hidden">
    <div style="color:#565f89;font-size:12px;margin-bottom:20px;text-transform:uppercase;letter-spacing:0.08em">terminal</div>
    <div style="color:#565f89;font-size:14px;margin-bottom:8px">$ previous-command --flag</div>
    <div style="color:#565f89;font-size:13px;margin-bottom:16px;padding-left:14px">output from previous step...</div>
    <div style="color:#7dcfff;font-size:15px;font-weight:bold;margin-bottom:4px">$ current-command --option value</div>
    <div style="color:#9ece6a;font-size:13px;padding-left:14px">Success: operation completed.<br>Details of what happened.</div>
  </div>
  <div style="background:#1e2030;padding:28px;overflow:hidden">
    <div style="color:#565f89;font-size:12px;margin-bottom:16px;text-transform:uppercase;letter-spacing:0.08em">file structure</div>
    <div style="display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;align-items:center;gap:8px;padding:8px;background:#16161e;border-radius:4px;border-left:3px solid #bb9af7">
        <span style="color:#bb9af7">&#9660;</span>
        <span style="color:#c0caf5;font-size:13px">my-project/</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 8px 8px 28px;background:#16161e;border-radius:4px">
        <span style="color:#7dcfff;font-size:13px">src/</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 8px 8px 48px">
        <span style="color:#9ece6a;font-size:13px">index.js</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 8px 8px 28px">
        <span style="color:#9ece6a;font-size:13px">package.json</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 8px 8px 28px">
        <span style="color:#565f89;font-size:13px">.gitignore</span>
      </div>
    </div>
  </div>
  <div style="grid-column:1/-1;background:#16161e;border-top:1px solid #2a2b3d;display:flex;gap:12px;align-items:center;padding:0 28px">
    <div style="border-left:3px solid #7dcfff;padding:4px 10px"><span style="color:#7dcfff;font-size:11px">concept 1</span><span style="color:#565f89;font-size:11px"> → explication courte</span></div>
    <div style="border-left:3px solid #bb9af7;padding:4px 10px"><span style="color:#bb9af7;font-size:11px">concept 2</span><span style="color:#565f89;font-size:11px"> → explication courte</span></div>
    <div style="border-left:3px solid #9ece6a;padding:4px 10px"><span style="color:#9ece6a;font-size:11px">concept 3</span><span style="color:#565f89;font-size:11px"> → explication courte</span></div>
  </div>
</div>`;

function getTemplate(topic) {
  const t = (topic || '').toLowerCase();
  if (t.includes('github') || t.includes('git')) return TEMPLATE_GIT;
  if (t.includes('docker')) return TEMPLATE_DOCKER;
  return TEMPLATE_TERMINAL;
}

function extractHTML(raw) {
  if (!raw) return '';
  const fence = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const htmlIdx = raw.indexOf('<');
  return htmlIdx >= 0 ? raw.slice(htmlIdx).trim() : raw.trim();
}

async function generateSlideHTML(step, topic, previousSteps) {
  const stepNumber = step.step ?? 0;
  const stepTitle = step.title || '';
  const stepAction = step.command || step.action || step.title || '';
  const stepExplanation = step.explanation || step.description || '';
  const prevLabels = (previousSteps || []).map(s => s.title || '').filter(Boolean);

  const userPrompt = `
Topic: ${topic}
Step ${stepNumber}: ${stepTitle}
Action: ${stepAction}
Explanation: ${stepExplanation}
Previous steps: ${prevLabels.join(' → ') || 'none'}

Follow this template EXACTLY for the HTML structure. Only change the text content to match this step:

${getTemplate(topic)}
`;

  const response = await client.chat.completions.create({
    model: SLIDE_MODEL,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: SLIDE_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  return extractHTML(response.choices[0].message.content || '');
}

let _browserPromise = null;
async function getBrowser() {
  if (!_browserPromise) {
    _browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return _browserPromise;
}

async function screenshotSlide(html, outputPath) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.screenshot({ path: outputPath, type: 'png', clip: { x: 0, y: 0, width: 1280, height: 720 } });
    return outputPath;
  } finally {
    await page.close().catch(() => {});
  }
}

async function renderFallbackSlide(step, outputPath) {
  const label = (step.title || `Step ${step.step}`).slice(0, 60);
  const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = Buffer.from(`<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
    <rect width="1280" height="720" fill="#1a1b26"/>
    <text x="640" y="360" fill="#c0caf5" font-family="monospace" font-size="36" text-anchor="middle" dominant-baseline="middle">${escape(label)}</text>
  </svg>`);
  await sharp(svg).png().toFile(outputPath);
  return outputPath;
}

async function generateAllSlides(script, topic, sessionDir, emitProgress = () => {}) {
  const imgDir = path.join(sessionDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  emitProgress('research:screenshots:start', { total: script.steps.length });

  const normalizedTopic = normalize(topic);
  let count = 0;

  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i];
    const stepNum = String(step.step ?? i + 1).padStart(2, '0');
    const mainFile = `step-${stepNum}.png`;
    const mainPath = path.join(imgDir, mainFile);
    const previousSteps = script.steps.slice(0, i);

    const cacheKeyStr = hashKey(`slide:${normalizedTopic}:${i}:${normalize(step.title || '')}`);

    let html = null;
    const cached = await cacheGet('slide', cacheKeyStr);
    if (cached && cached.value && cached.value.html) {
      html = cached.value.html;
      emitProgress('screenshot:cached', { step: step.step });
    }

    if (!html) {
      try {
        emitProgress('screenshot:search', { step: step.step, query: step.title });
        html = await generateSlideHTML(step, topic, previousSteps);
        if (html) await cacheSet('slide', cacheKeyStr, { html }, null, 7);
      } catch (err) {
        console.error(`[slide] HTML gen failed step ${step.step}:`, err.message);
      }
    }

    let rendered = false;
    if (html) {
      try {
        await screenshotSlide(html, mainPath);
        rendered = true;
      } catch (err) {
        console.error(`[slide] Puppeteer render failed step ${step.step}:`, err.message);
      }
    }

    if (!rendered) {
      await renderFallbackSlide(step, mainPath);
    }

    step.screenshot = mainFile;
    step.candidates = [];
    step.validCandidates = [];
    step.picked = 0;
    count++;

    emitProgress('screenshot:done', {
      step: step.step,
      picked: 1,
      total: 1,
      valid: 1,
      candidates: [mainFile],
      fromSlide: true,
    });
  }

  emitProgress('research:screenshots:done', { count });
  emitProgress('annotation:start', { total: count });
  emitProgress('annotation:done', {});

  return count;
}

async function closeBrowser() {
  if (_browserPromise) {
    const browser = await _browserPromise;
    await browser.close().catch(() => {});
    _browserPromise = null;
  }
}

module.exports = { generateSlideHTML, screenshotSlide, generateAllSlides, closeBrowser };
