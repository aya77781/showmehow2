require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();
const BASE_OUT = path.resolve(__dirname, '..', 'output', 'evals');

function findClaude() {
  const paths = [
    '/opt/homebrew/Cellar/node/24.5.0/bin/claude',
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// --- WikiHow ---
async function getWikiHowContext(query) {
  try {
    const res = await fetch(
      `https://www.wikihow.com/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`
    );
    const data = await res.json();
    const titles = data.query.search.map(r => r.title);
    if (titles.length === 0) return [];

    let best = [];
    for (const title of titles.slice(0, 2)) {
      const res2 = await fetch(
        `https://www.wikihow.com/api.php?action=parse&page=${encodeURIComponent(title)}&prop=sections&format=json&origin=*`
      );
      const d = await res2.json();
      const skip = ['Video', 'References', 'Tips', 'Warnings', 'Quick Summary', 'Related wikiHows', 'Expert Interview', 'Steps', 'Things You'];
      const steps = (d.parse?.sections || [])
        .filter(s => s.toclevel <= 2 && !skip.some(k => s.line.includes(k)))
        .map(s => s.line.replace(/<[^>]*>/g, ''));
      if (steps.length > best.length) best = steps;
    }
    return best;
  } catch { return []; }
}

// --- Claude + Web Search ---
async function generateScript(topic, wikiSteps) {
  const fallback = wikiSteps.length > 0 ? wikiSteps : ['Navigate to the service', 'Create account', 'Follow setup', 'Configure settings', 'Complete'];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{
      role: 'user',
      content: `You are a tutorial video script creator.

Topic: "${topic}"

WikiHow base steps:
${fallback.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Instructions:
1. Use web search to find the ACTUAL current steps for "${topic}"
2. Create a detailed step-by-step tutorial (5-8 steps)
3. Each step: title + 2-3 sentence video narration + specific action to perform on page
4. Include the starting URL

Return ONLY valid JSON:
{"title":"...","url":"starting url","steps":[{"step":1,"title":"...","description":"2-3 sentence narration","action":"click X, type Y, scroll to Z"}]}`
    }]
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
  const i = text.indexOf('{'), j = text.lastIndexOf('}');
  if (i === -1) throw new Error('No JSON from Claude');
  return JSON.parse(text.slice(i, j + 1));
}

// --- Playwright MCP screenshots ---
function captureScreenshots(tutorial, imgDir) {
  const claude = findClaude();
  if (!claude) return false;

  const stepsInstructions = tutorial.steps.map(s =>
    `Step ${s.step}: "${s.title}" — Do: ${s.action || s.description}`
  ).join('\n');

  const prompt = `Capture screenshots for a tutorial: "${tutorial.title}"

Use Playwright MCP to:
1. Navigate to ${tutorial.url}
2. Wait for the page to fully load
3. Take a screenshot and save as ${imgDir}/step-01.png

Then for each step, perform the described action and take a screenshot:
${stepsInstructions}

Save each screenshot as ${imgDir}/step-XX.png (zero-padded).

IMPORTANT:
- Wait for page loads between actions
- If login is required, screenshot the login page and move on
- Capture the FULL page state after each action
- Take exactly ${tutorial.steps.length} screenshots

When done respond: SCREENSHOTS_COMPLETE`;

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const proc = spawnSync(claude, ['-p', '--dangerously-skip-permissions'], {
    input: prompt,
    encoding: 'utf-8',
    timeout: 300000,
    maxBuffer: 5 * 1024 * 1024,
    env,
  });

  return proc.status === 0;
}

// --- Eval ---
function evaluate(tutorial, topic, imgDir, timings) {
  const steps = tutorial.steps || [];
  const n = steps.length;
  const scores = {};

  // Step count (5-8 ideal)
  scores.step_count = n >= 5 && n <= 8 ? 10 : n >= 3 && n <= 10 ? 7 : n > 0 ? 3 : 0;

  // Relevance
  const words = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const title = (tutorial.title || '').toLowerCase();
  scores.relevance = Math.round((words.filter(w => title.includes(w)).length / Math.max(words.length, 1)) * 10);

  // Narration quality
  const withDesc = steps.filter(s => s.description?.length > 30).length;
  scores.narration = Math.round((withDesc / Math.max(n, 1)) * 10);

  // Action specificity
  const withAction = steps.filter(s => s.action?.length > 10).length;
  scores.action_quality = Math.round((withAction / Math.max(n, 1)) * 10);

  // Has URL
  scores.has_url = tutorial.url?.startsWith('http') ? 10 : 0;

  // Screenshot coverage
  let screenshotCount = 0;
  let totalSize = 0;
  for (const s of steps) {
    const file = path.join(imgDir, `step-${String(s.step).padStart(2, '0')}.png`);
    if (fs.existsSync(file)) {
      screenshotCount++;
      totalSize += fs.statSync(file).size;
    }
  }
  scores.screenshot_coverage = Math.round((screenshotCount / Math.max(n, 1)) * 10);

  // Screenshot quality (size variety = different pages)
  if (screenshotCount >= 2) {
    const avgSize = totalSize / screenshotCount;
    const sizes = steps
      .filter(s => fs.existsSync(path.join(imgDir, `step-${String(s.step).padStart(2, '0')}.png`)))
      .map(s => fs.statSync(path.join(imgDir, `step-${String(s.step).padStart(2, '0')}.png`)).size);
    const variance = sizes.reduce((sum, sz) => sum + Math.abs(sz - avgSize), 0) / sizes.length;
    const varietyPct = variance / avgSize;
    scores.screenshot_variety = varietyPct > 0.15 ? 10 : varietyPct > 0.05 ? 7 : 4;
  } else {
    scores.screenshot_variety = screenshotCount > 0 ? 3 : 0;
  }

  // Speed
  const sec = timings.total / 1000;
  scores.speed = sec < 60 ? 10 : sec < 120 ? 7 : sec < 180 ? 5 : 2;

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const max = Object.keys(scores).length * 10;

  return {
    scores,
    total,
    max,
    pct: Math.round((total / max) * 100),
    screenshots: screenshotCount,
    totalScreenshotKB: Math.round(totalSize / 1024),
    time_sec: sec.toFixed(1),
  };
}

// --- Test Cases ---
const TESTS = [
  { topic: 'How to deploy a website on Vercel with a custom domain', url_hint: 'vercel.com/new', difficulty: 'medium' },
  { topic: 'How to create a GitHub repository with README and license', url_hint: 'github.com/new', difficulty: 'easy' },
  { topic: 'How to set up a Shopify store and add your first product', url_hint: 'shopify.com', difficulty: 'hard' },
];

async function runTest(test, index) {
  const slug = test.topic.slice(0, 30).replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const testDir = path.join(BASE_OUT, slug);
  const imgDir = path.join(testDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  console.log(`\n${'━'.repeat(70)}`);
  console.log(`[${index + 1}/${TESTS.length}] "${test.topic}" [${test.difficulty}]`);
  console.log('━'.repeat(70));

  const timings = {};
  const t0 = Date.now();

  // Phase 1: WikiHow
  console.log('   📚 WikiHow...');
  const tW = Date.now();
  const wikiSteps = await getWikiHowContext(test.topic);
  timings.wikihow = Date.now() - tW;
  console.log(`      ${wikiSteps.length} steps (${timings.wikihow}ms)`);

  // Phase 2: Claude + Web Search
  console.log('   🤖 Claude + Web Search...');
  const tC = Date.now();
  const tutorial = await generateScript(test.topic, wikiSteps);
  timings.claude = Date.now() - tC;
  console.log(`      ${tutorial.steps.length} steps (${timings.claude}ms)`);
  console.log(`      URL: ${tutorial.url}`);
  tutorial.steps.forEach(s => console.log(`      ${s.step}. ${s.title}`));

  // Phase 3: Playwright screenshots
  console.log('   📸 Playwright MCP...');
  const tP = Date.now();
  captureScreenshots(tutorial, imgDir);
  timings.playwright = Date.now() - tP;
  timings.total = Date.now() - t0;

  // Check screenshots
  for (const s of tutorial.steps) {
    const file = `step-${String(s.step).padStart(2, '0')}.png`;
    const fullPath = path.join(imgDir, file);
    const exists = fs.existsSync(fullPath);
    s.screenshot = exists ? file : null;
    const size = exists ? `${(fs.statSync(fullPath).size / 1024).toFixed(0)}KB` : '';
    console.log(`      ${exists ? '✅' : '⚠️'}  ${file} ${size}`);
  }
  console.log(`      ⏱️  ${(timings.playwright / 1000).toFixed(1)}s`);

  // Evaluate
  const ev = evaluate(tutorial, test.topic, imgDir, timings);
  console.log(`   📊 Score: ${ev.pct}% (${ev.total}/${ev.max})`);

  // Save tutorial JSON
  fs.writeFileSync(path.join(testDir, 'tutorial.json'), JSON.stringify(tutorial, null, 2));

  // Save markdown
  const md = [
    `# ${tutorial.title}\n`,
    `> URL: ${tutorial.url}\n`,
    `---\n`,
  ];
  for (const s of tutorial.steps) {
    md.push(`### Step ${s.step}: ${s.title}\n`);
    if (s.screenshot) md.push(`![Step ${s.step}](images/${s.screenshot})\n`);
    md.push(`🎙️ *"${s.description}"*\n`);
    if (s.action) md.push(`▶️ **Action:** ${s.action}\n`);
    md.push(`---\n`);
  }
  md.push(`*ShowMe AI — ${new Date().toISOString().split('T')[0]}*`);
  fs.writeFileSync(path.join(testDir, 'video-script.md'), md.join('\n'));

  return { test, tutorial, eval: ev, timings };
}

async function main() {
  console.log('🧪 ShowMe AI — Full Pipeline Eval (WikiHow + Claude WS + Playwright MCP)');
  console.log(`   ${TESTS.length} test cases\n`);

  fs.mkdirSync(BASE_OUT, { recursive: true });

  const results = [];
  for (let i = 0; i < TESTS.length; i++) {
    results.push(await runTest(TESTS[i], i));
  }

  // Final summary
  console.log(`\n${'━'.repeat(70)}`);
  console.log('📊 FINAL EVAL — Full Pipeline');
  console.log('━'.repeat(70));
  console.log(`${'Topic'.padEnd(40)} Steps  Imgs  Time     Score`);
  console.log('─'.repeat(70));

  for (const r of results) {
    const t = r.test.topic.slice(0, 39).padEnd(40);
    const steps = String(r.tutorial.steps.length).padEnd(6);
    const imgs = String(r.eval.screenshots).padEnd(6);
    const time = `${r.eval.time_sec}s`.padEnd(9);
    console.log(`${t} ${steps} ${imgs} ${time}${r.eval.pct}%`);
  }

  const avg = Math.round(results.reduce((s, r) => s + r.eval.pct, 0) / results.length);
  const avgTime = (results.reduce((s, r) => s + r.timings.total, 0) / results.length / 1000).toFixed(1);
  const avgImgs = Math.round(results.reduce((s, r) => s + r.eval.screenshots, 0) / results.length);
  console.log('─'.repeat(70));
  console.log(`${'AVERAGE'.padEnd(40)}        ${String(avgImgs).padEnd(6)} ${avgTime.padEnd(9)}s${avg}%`);

  // Score breakdown
  console.log(`\n📈 Score Breakdown (avg across all tests):`);
  const allScoreKeys = Object.keys(results[0].eval.scores);
  for (const key of allScoreKeys) {
    const avgScore = (results.reduce((s, r) => s + r.eval.scores[key], 0) / results.length).toFixed(1);
    const bar = '█'.repeat(Math.round(avgScore)) + '░'.repeat(10 - Math.round(avgScore));
    console.log(`   ${bar} ${avgScore}/10  ${key}`);
  }

  // Comparison
  console.log(`\n📈 Method Comparison:`);
  console.log(`   WikiHow only:            53%  |  2-3s    |  0 screenshots  |  no narration`);
  console.log(`   Playwright MCP only:     89%  |  120-180s|  8 screenshots  |  basic narration`);
  console.log(`   WikiHow + Claude WS:     94%  |  25-42s  |  0 screenshots  |  rich narration`);
  console.log(`   Full Pipeline:           ${avg}%  |  ${avgTime}s  |  ${avgImgs} screenshots  |  rich narration`);

  // Save eval summary
  const summary = {
    date: new Date().toISOString(),
    method: 'WikiHow + Claude Web Search + Playwright MCP',
    tests: results.map(r => ({
      topic: r.test.topic,
      difficulty: r.test.difficulty,
      steps: r.tutorial.steps.length,
      screenshots: r.eval.screenshots,
      totalScreenshotKB: r.eval.totalScreenshotKB,
      eval: r.eval,
      timings: r.timings,
    })),
    averages: { score: avg, time_sec: avgTime, screenshots: avgImgs },
  };
  fs.writeFileSync(path.join(BASE_OUT, 'eval-full-pipeline.json'), JSON.stringify(summary, null, 2));

  console.log(`\n📁 Results saved to output/evals/`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
