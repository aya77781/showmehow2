# ShowMe AI — Agent Testing Roadmap

---

## Phase 0 — Environment Setup

```bash
mkdir showme-agent && cd showme-agent
npm init -y
npm install @anthropic-ai/sdk @playwright/mcp playwright dotenv axios
npx playwright install chromium
```

```bash
# .env
ANTHROPIC_API_KEY=sk-...
RAPIDAPI_KEY=...        # for WikiHow (optional)
VEED_API_KEY=...        # leave empty for now, mock it in early phases
```

---

## Phase 1 — Test WikiHow Context Fetch ✅

**Goal:** confirm we can pull structured steps from WikiHow before touching Playwright.

```javascript
// test/01-wikihow.test.js

const topic = "How to create a Google Ads campaign";

// 1a — Search WikiHow
const search = await fetch(
  `https://www.wikihow.com/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&format=json&origin=*`
);
const results = await search.json();
console.log("WikiHow results:", results.query.search.map(r => r.title));

// 1b — Fetch steps for top result
const topTitle = results.query.search[0].title;
const article = await fetch(
  `https://www.wikihow.com/api.php?action=parse&page=${encodeURIComponent(topTitle)}&prop=sections&format=json&origin=*`
);
const parsed = await article.json();
console.log("Sections:", parsed.parse.sections.map(s => s.line));
```

**Expected output:**
```
WikiHow results: ["Advertise on Google", "Create a Google Ads Account", ...]
Sections: ["Part 1: Setting Up Your Campaign", "Part 2: Choosing Keywords", ...]
```

**Pass criteria:** returns at least 3 steps for any given topic.

---

## Phase 2 — Test Playwright MCP Browser Control ✅

**Goal:** confirm Playwright opens a browser, navigates, and takes screenshots.

```javascript
// test/02-playwright.test.js
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false }); // headed for visual debug
const page = await browser.newPage();

// Step 1 — navigate
await page.goto('https://github.com');
const screenshot1 = await page.screenshot({ path: 'screenshots/step-01.png' });
console.log("✅ Screenshot 1 taken");

// Step 2 — interact
await page.click('a[href="/login"]');
await page.screenshot({ path: 'screenshots/step-02.png' });
console.log("✅ Screenshot 2 taken");

await browser.close();
```

**Expected output:**
```
✅ Screenshot 1 taken  →  screenshots/step-01.png
✅ Screenshot 2 taken  →  screenshots/step-02.png
```

**Pass criteria:** screenshots folder has PNG files with visible UI.

---

## Phase 3 — Test Claude Vision on Screenshots ✅

**Goal:** confirm Claude can read a screenshot and describe what happened + suggest next action.

```javascript
// test/03-claude-vision.test.js
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';

const client = new Anthropic();
const screenshot = fs.readFileSync('screenshots/step-01.png');
const base64 = screenshot.toString('base64');

const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 500,
  messages: [{
    role: 'user',
    content: [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: base64 }
      },
      {
        type: 'text',
        text: `You are a tutorial narrator. 
        Look at this screenshot and return JSON:
        {
          "step_title": "short title of what this step shows",
          "narration": "2-3 sentence narration for a tutorial video",
          "what_to_click_next": "describe the next element to interact with or null if done"
        }`
      }
    ]
  }]
});

console.log(JSON.parse(response.content[0].text));
```

**Expected output:**
```json
{
  "step_title": "GitHub Homepage",
  "narration": "This is the GitHub homepage. Here you can sign in to your account or explore public repositories. To get started, click the Sign In button in the top right corner.",
  "what_to_click_next": "Sign in button in the top navigation bar"
}
```

**Pass criteria:** valid JSON with all 3 fields, narration makes sense for the screenshot.

---

## Phase 4 — Test Full Agent Loop ✅

**Goal:** chain WikiHow + Playwright + Claude into a single flow that produces a script.

```javascript
// test/04-agent-loop.test.js

const topic = "How to create a GitHub repository";
const steps = [];

// 1 — Get WikiHow context
const wikiContext = await fetchWikiHowSteps(topic);

// 2 — Open browser
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://github.com/new');

let stepNumber = 1;
let isDone = false;

while (!isDone && stepNumber <= 10) { // max 10 steps safety limit
  // 3 — Take screenshot
  const screenshot = await page.screenshot({ 
    path: `screenshots/step-${String(stepNumber).padStart(2, '0')}.png`,
    type: 'jpeg',
    quality: 70 // compress = fewer tokens
  });

  // 4 — Claude analyzes screenshot
  const analysis = await claudeAnalyzeStep({
    screenshot,
    stepNumber,
    topic,
    wikiContext,
    previousSteps: steps
  });

  steps.push({
    step: stepNumber,
    screenshot: `step-${String(stepNumber).padStart(2, '0')}.png`,
    title: analysis.step_title,
    narration: analysis.narration
  });

  console.log(`Step ${stepNumber}: ${analysis.step_title}`);

  // 5 — Execute next action or stop
  if (analysis.is_complete || !analysis.next_action) {
    isDone = true;
  } else {
    await executeAction(page, analysis.next_action);
    stepNumber++;
  }
}

// 6 — Output full script
fs.writeFileSync('output/script.json', JSON.stringify(steps, null, 2));
console.log(`\n✅ Tutorial script generated: ${steps.length} steps`);
await browser.close();
```

**Expected output:**
```
Step 1: Navigate to New Repository
Step 2: Enter Repository Name
Step 3: Set Repository Visibility
Step 4: Initialize with README
Step 5: Click Create Repository
Step 6: Repository Created

✅ Tutorial script generated: 6 steps
→ output/script.json
```

**Pass criteria:** `script.json` has 3–10 steps, each with title + narration + screenshot filename.

---

## Phase 5 — Mock VEED Video Generation ✅

**Goal:** test the video pipeline without burning VEED credits during dev.

```javascript
// test/05-veed-mock.test.js

// Mock VEED response
const mockVeedResponse = {
  video_id: "mock-123",
  video_url: "https://veed.io/view/mock-123",
  status: "rendered",
  duration_seconds: 45
};

// Real call structure (uncomment when VEED key is ready)
/*
const veedResponse = await fetch('https://api.veed.io/v1/videos', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.VEED_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    avatar_id: "your-avatar-id",
    script: steps.map(s => ({
      text: s.narration,
      background_image: s.screenshot_url,
      duration: 8
    }))
  })
});
*/

console.log("✅ VEED mock passed:", mockVeedResponse);
```

**Pass criteria:** structure validated, ready to swap mock for real API call.

---

## Phase 6 — End-to-End Integration Test ✅

**Goal:** full pipeline from user input to video URL, timed for demo readiness.

```javascript
// test/06-e2e.test.js

console.time('total');

const topic = "How to create a GitHub repository";

console.time('wikihow');
const context = await fetchWikiHowSteps(topic);
console.timeEnd('wikihow'); // target: < 1s

console.time('playwright');
const screenshots = await captureFlow('https://github.com/new', topic, context);
console.timeEnd('playwright'); // target: < 30s

console.time('claude');
const script = await generateScript(screenshots, topic, context);
console.timeEnd('claude'); // target: < 10s

console.time('veed');
const videoUrl = await renderVideo(script); // mock or real
console.timeEnd('veed'); // target: < 60s (real) / < 1s (mock)

console.timeEnd('total'); // target: < 2min end-to-end

console.log("\n✅ E2E passed");
console.log("Video URL:", videoUrl);
console.log("Steps generated:", script.length);
```

**Target times:**

| Phase | Target | Acceptable |
|---|---|---|
| WikiHow fetch | < 1s | < 3s |
| Playwright capture | < 30s | < 60s |
| Claude script gen | < 10s | < 20s |
| VEED render | < 60s | < 120s |
| **Total** | **< 2 min** | **< 3 min** |

---

## Test Topics (safe for demo)

| Topic | URL | Bot risk | Expected steps |
|---|---|---|---|
| Create a GitHub repo | github.com/new | ✅ None | 5–7 |
| Deploy to Vercel | vercel.com/new | ✅ None | 6–8 |
| Create a Notion page | notion.so | ✅ None | 4–6 |
| Open a Trello board | trello.com | ⚠️ Login | 5–7 |
| Set up Google Ads | ads.google.com | ⚠️ Login | 8–12 |

**Recommended for hackathon demo:** GitHub repo creation — no login, clean UI, 5–7 steps, always works.

---

## Run All Tests

```bash
# Run phases in order
node test/01-wikihow.test.js
node test/02-playwright.test.js
node test/03-claude-vision.test.js
node test/04-agent-loop.test.js
node test/05-veed-mock.test.js
node test/06-e2e.test.js
```

Or with a single script:

```bash
# package.json
"scripts": {
  "test:wikihow":    "node test/01-wikihow.test.js",
  "test:playwright": "node test/02-playwright.test.js",
  "test:vision":     "node test/03-claude-vision.test.js",
  "test:loop":       "node test/04-agent-loop.test.js",
  "test:veed":       "node test/05-veed-mock.test.js",
  "test:e2e":        "node test/06-e2e.test.js",
  "test:all":        "npm run test:wikihow && npm run test:playwright && npm run test:vision && npm run test:loop && npm run test:veed && npm run test:e2e"
}
```

```bash
npm run test:all
```

---

## Folder Structure

```
showme-agent/
├── test/
│   ├── 01-wikihow.test.js
│   ├── 02-playwright.test.js
│   ├── 03-claude-vision.test.js
│   ├── 04-agent-loop.test.js
│   ├── 05-veed-mock.test.js
│   └── 06-e2e.test.js
├── screenshots/       ← auto-generated during tests
├── output/
│   └── script.json    ← generated tutorial script
├── src/
│   ├── wikihow.js
│   ├── playwright.js
│   ├── claude.js
│   └── veed.js
├── .env
└── package.json
```

---

*ShowMe AI — AMS GenAI & Video Hackathon 2026*