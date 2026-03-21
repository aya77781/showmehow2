# ShowMe AI — Technical Roadmap

---

## Stack Decision

| Layer | Tool | Why |
|---|---|---|
| **Browser automation** | `@playwright/mcp` (Microsoft) | Official, actively maintained, Node.js native |
| **AI agent** | Node.js + Anthropic SDK | Tool use loop, screenshot vision, script generation |
| **Video generation** | VEED Fabric API | Avatar + narration + rendering |
| **Visuals** | Runware API | AI-generated images per step |
| **Frontend** | Lovable | Landing + dashboard fast |
| **Token optimization** | Dockerized Claude Code | Runs headless, reusable context, no UI token waste |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   USER REQUEST                       │
│         "How do I create a Google Ad?"              │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│              NODE.JS AGENT (orchestrator)            │
│                                                      │
│  1. Receives topic from user                        │
│  2. Spins up Playwright MCP                         │
│  3. Calls Claude vision loop                        │
│  4. Builds tutorial script                          │
│  5. Sends to VEED for rendering                     │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│           PLAYWRIGHT MCP (@playwright/mcp)           │
│                                                      │
│  npx @playwright/mcp@latest                         │
│                                                      │
│  → navigate(url)                                    │
│  → screenshot()          ← sends to Claude          │
│  → click(element)                                   │
│  → fill(input, value)                               │
│  → screenshot()          ← sends to Claude          │
│  → repeat until flow complete                       │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│         CLAUDE VISION LOOP (per screenshot)          │
│                                                      │
│  Input:  screenshot + previous steps context        │
│  Output: {                                           │
│    step_title: "Navigate to Campaigns",             │
│    narration: "Click on the blue button...",        │
│    next_action: { type: "click", target: "..." },   │
│    is_complete: false                               │
│  }                                                   │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│              SCRIPT BUILDER (Node.js)                │
│                                                      │
│  [                                                   │
│    { step: 1, screenshot: "s1.png",                 │
│      narration: "Go to ads.google.com..." },        │
│    { step: 2, screenshot: "s2.png",                 │
│      narration: "Click on New Campaign..." },       │
│    ...                                               │
│  ]                                                   │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│              VEED FABRIC API                         │
│                                                      │
│  → avatar narrates each step                        │
│  → screenshots as background per step               │
│  → chapters generated automatically                 │
│  → video rendered and returned as URL               │
└─────────────────────────────────────────────────────┘
```

---

## Playwright MCP Setup

### Option 1 — Official Microsoft (recommended)
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--vision"]
    }
  }
}
```
> `--vision` flag enables screenshot mode (needed for Claude to see the screen)

### Option 2 — ExecuteAutomation (more features, device emulation)
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@executeautomation/playwright-mcp-server"]
    }
  }
}
```
> Supports 143 device presets (iPhone, iPad, Desktop Chrome, etc.)

---

## Token Optimization: Dockerized Claude Code

The problem: running Claude vision on every screenshot is expensive if done naively.

### Solution: Docker container with Claude Code headless

```dockerfile
# Dockerfile
FROM node:20-slim

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install Playwright + browsers
RUN npx playwright install-deps chromium
RUN npx playwright install chromium

WORKDIR /app
COPY . .
RUN npm install

# Run agent headless
CMD ["node", "agent.js"]
```

```bash
docker build -t showme-agent .
docker run -e ANTHROPIC_API_KEY=sk-... showme-agent
```

### Token-saving strategies inside the container

```javascript
// agent.js — batched screenshots, not one call per step
const steps = await playwrightMCP.captureFlow(url, topic);

// Send ALL screenshots in ONE Claude call with low-res compression
const script = await claude.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 2000,
  messages: [{
    role: "user",
    content: [
      ...steps.screenshots.map((s, i) => ({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg",
          data: compressToBase64(s, { quality: 60 }) } // 60% quality = 40% less tokens
      })),
      { type: "text", text: `Generate a tutorial script for: ${topic}. 
        Return JSON array with {step, narration, title} for each screenshot.` }
    ]
  }]
});
```

**Why this saves tokens:**
- 1 Claude call for all screenshots instead of N calls
- Compressed JPEG screenshots (60% quality is enough for UI recognition)
- Structured JSON output → no verbose back-and-forth
- Docker container reuses the Node.js process → no cold start overhead

---

## WikiHow API — Context Layer for the Agent

WikiHow has no official public API, but it runs on MediaWiki — so you can hit it directly. Two options:

### Option 1 — WikiHow MediaWiki API (free, no key needed)
```javascript
// Search WikiHow for a topic
const searchWikiHow = async (topic) => {
  const url = `https://www.wikihow.com/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  return data.query.search; // returns titles + snippets
};

// Fetch full article steps by title
const getWikiHowSteps = async (title) => {
  const url = `https://www.wikihow.com/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  return data.parse.wikitext['*']; // raw wikitext with steps
};
```

### Option 2 — RapidAPI WikiHow (cleaner JSON, free tier)
```
GET https://wikihow.p.rapidapi.com/search?q=how+to+create+google+ads&count=5
Headers: X-RapidAPI-Key: YOUR_KEY
```
Returns structured steps, images, methods — ready to inject into Claude's context.

### How it plugs into the agent

```
User: "How do I set up Google Ads?"
        ↓
Agent fetches WikiHow → "How to Advertise on Google"
        ↓
Gets: intro + steps + methods + warnings
        ↓
Injects as context into Claude BEFORE Playwright starts:
"Here is the expected flow from WikiHow: Step 1... Step 2..."
        ↓
Claude navigates smarter — knows what to look for on screen
        ↓
Playwright confirms each step visually with screenshots
        ↓
Final tutorial = WikiHow knowledge + real screenshots
```

### Why this matters

- **WikiHow = the script skeleton** — Claude knows the steps before even opening the browser
- **Playwright = the visual proof** — screenshots confirm each step in the actual UI
- **Claude bridges both** — narrates in natural language combining WikiHow context + what it sees on screen
- **Fallback** — if Playwright gets blocked, WikiHow steps alone can still generate a useful tutorial

---

## Hackathon Roadmap (24 hours)

### Hour 0–2 — Setup
- [ ] Init Node.js project
- [ ] Install `@playwright/mcp@latest` + `@anthropic/sdk`
- [ ] Configure `.env` (ANTHROPIC_API_KEY, VEED_API_KEY)
- [ ] Test Playwright MCP opens a browser and takes a screenshot

### Hour 2–6 — Core agent loop
- [ ] Build `captureFlow(url, topic)` — Playwright navigates + screenshots
- [ ] Build `generateScript(screenshots)` — Claude vision → JSON script
- [ ] Log output to console, verify quality

### Hour 6–10 — VEED integration
- [ ] Connect VEED Fabric API
- [ ] Configure avatar (voice, appearance)
- [ ] Send script + screenshots → receive video URL
- [ ] Test end-to-end: topic in → video URL out

### Hour 10–16 — Frontend (Lovable)
- [ ] Landing page with email signup
- [ ] Onboarding: interests + avatar customization
- [ ] Dashboard: tutorial input + video player
- [ ] "Create Tutorial" button triggers agent

### Hour 16–20 — Polish + demo prep
- [ ] Choose 2–3 demo topics that work reliably (Vercel deploy, Google Ads, GitHub PR)
- [ ] Record fallback video in case of live demo failure
- [ ] Add loading states + progress bar in UI

### Hour 20–24 — Pitch
- [ ] Rehearse live demo
- [ ] Finalize pitch deck (5 slides max)
- [ ] Deploy to Railway or Fly.io

---

## Demo Topics (bot-detection safe)

| Topic | Site | Risk |
|---|---|---|
| How to create a GitHub repository | github.com | ✅ Safe |
| How to deploy to Vercel | vercel.com | ✅ Safe |
| How to create a Notion page | notion.so | ✅ Safe |
| How to set up a Google Ads campaign | ads.google.com | ⚠️ Login required |
| How to publish on Product Hunt | producthunt.com | ⚠️ Login required |

**Recommendation for hackathon:** demo with GitHub or Vercel — no login needed, no bot detection, clean UI.

---

## File Structure

```
showme-ai/
├── agent/
│   ├── agent.js          ← main orchestrator
│   ├── playwright.js     ← Playwright MCP client
│   ├── claude.js         ← vision + script generation
│   └── veed.js           ← video rendering
├── api/
│   └── server.js         ← Express API for frontend
├── frontend/             ← Lovable export or custom
├── Dockerfile
├── docker-compose.yml
└── .env
```

---

*ShowMe AI — Built at AMS GenAI & Video Hackathon 2026*