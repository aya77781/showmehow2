require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();
const OUT_DIR = path.resolve(__dirname, '..', 'output', 'evals');

// --- WikiHow ---
async function searchWikiHow(query) {
  const res = await fetch(
    `https://www.wikihow.com/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`
  );
  const data = await res.json();
  return data.query.search.map(r => r.title);
}

async function getWikiHowSections(title) {
  const res = await fetch(
    `https://www.wikihow.com/api.php?action=parse&page=${encodeURIComponent(title)}&prop=sections&format=json&origin=*`
  );
  const data = await res.json();
  const skip = ['Video', 'References', 'Tips', 'Warnings', 'Quick Summary', 'Related wikiHows', 'Expert Interview', 'Steps', 'Things You'];
  return (data.parse?.sections || [])
    .filter(s => s.toclevel <= 2 && !skip.some(k => s.line.includes(k)))
    .map(s => s.line.replace(/<[^>]*>/g, ''));
}

// --- Claude + Web Search ---
async function enrichWithClaude(topic, wikihowSteps) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{
      role: 'user',
      content: `You are a tutorial video script creator.

Topic: "${topic}"

WikiHow base steps:
${wikihowSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Your job:
1. Use web search to find the ACTUAL current steps for "${topic}"
2. Create a detailed step-by-step tutorial (5-10 steps)
3. Each step needs a title and 2-3 sentence narration for a video
4. Include the starting URL

Return ONLY valid JSON, no markdown, no backticks:
{"title":"...","url":"starting url","source":"info source","steps":[{"step":1,"title":"...","description":"2-3 sentence video narration"}]}`
    }]
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock?.text || '';
}

// --- Eval ---
function evaluate(tutorial, topic, timings) {
  const s = {};
  const steps = tutorial.steps || [];
  const n = steps.length;

  // Step count
  s.step_count = n >= 3 && n <= 10 ? 10 : n > 0 ? 5 : 0;

  // Relevance
  const words = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const title = (tutorial.title || '').toLowerCase();
  s.relevance = Math.round((words.filter(w => title.includes(w)).length / Math.max(words.length, 1)) * 10);

  // Narration coverage
  const withDesc = steps.filter(st => st.description?.length > 20).length;
  s.narration = Math.round((withDesc / Math.max(n, 1)) * 10);

  // Title quality
  const goodTitles = steps.filter(st => st.title?.length > 5).length;
  s.title_quality = Math.round((goodTitles / Math.max(n, 1)) * 10);

  // Has URL
  s.has_url = tutorial.url && tutorial.url.startsWith('http') ? 10 : 0;

  // Speed
  const sec = timings.total / 1000;
  s.speed = sec < 15 ? 10 : sec < 30 ? 7 : sec < 60 ? 5 : 2;

  const total = Object.values(s).reduce((a, b) => a + b, 0);
  const max = Object.keys(s).length * 10;

  return { scores: s, total, max, pct: Math.round((total / max) * 100), time_sec: sec.toFixed(1) };
}

// --- Test Cases ---
const TESTS = [
  { topic: 'How to set up a Google Ads campaign with conversion tracking', difficulty: 'hard' },
  { topic: 'How to deploy a website on Vercel with a custom domain', difficulty: 'medium' },
  { topic: 'How to create a Facebook Business Page and run your first ad', difficulty: 'hard' },
  { topic: 'How to set up a Shopify store', difficulty: 'medium' },
  { topic: 'How to create a GitHub Actions CI/CD pipeline', difficulty: 'hard' },
];

async function runTest(test, index) {
  const label = `[${index + 1}/${TESTS.length}]`;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${label} "${test.topic}" [${test.difficulty}]`);
  console.log('='.repeat(70));

  const timings = {};
  const t0 = Date.now();

  // WikiHow
  const tW = Date.now();
  const titles = await searchWikiHow(test.topic);
  let wikiSteps = [];
  for (const t of titles.slice(0, 2)) {
    const steps = await getWikiHowSections(t);
    if (steps.length > wikiSteps.length) wikiSteps = steps;
  }
  timings.wikihow = Date.now() - tW;
  console.log(`   WikiHow: ${wikiSteps.length} steps (${timings.wikihow}ms)`);

  if (wikiSteps.length === 0) {
    wikiSteps = ['Find the service', 'Create account', 'Setup wizard', 'Configure', 'Complete'];
    console.log('   ⚠️  Fallback steps');
  }

  // Claude + web search
  const tC = Date.now();
  const claudeRaw = await enrichWithClaude(test.topic, wikiSteps);
  timings.claude = Date.now() - tC;
  timings.total = Date.now() - t0;
  console.log(`   Claude: ${timings.claude}ms | Total: ${timings.total}ms`);

  // Parse
  const i = claudeRaw.indexOf('{'), j = claudeRaw.lastIndexOf('}');
  if (i === -1 || j === -1) {
    console.log('   ❌ No JSON');
    return { test, eval: { pct: 0 }, tutorial: null };
  }

  let tutorial;
  try { tutorial = JSON.parse(claudeRaw.slice(i, j + 1)); }
  catch (e) { console.log('   ❌ Bad JSON'); return { test, eval: { pct: 0 }, tutorial: null }; }

  const ev = evaluate(tutorial, test.topic, timings);

  // Print steps
  tutorial.steps?.forEach(s => console.log(`   ${s.step}. ${s.title}`));
  console.log(`   URL: ${tutorial.url || 'N/A'}`);
  console.log(`   📊 Score: ${ev.pct}% (${ev.total}/${ev.max}) | ${ev.time_sec}s`);

  return { test, eval: ev, tutorial, timings };
}

async function main() {
  console.log('🧪 ShowMe AI — WikiHow + Claude Web Search Eval');
  console.log(`   ${TESTS.length} test cases\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const results = [];
  for (let i = 0; i < TESTS.length; i++) {
    const r = await runTest(TESTS[i], i);
    results.push(r);
  }

  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log('📊 SUMMARY — WikiHow + Claude Web Search');
  console.log('='.repeat(70));
  console.log(`${'Topic'.padEnd(50)} Steps  Time    Score`);
  console.log('-'.repeat(70));

  for (const r of results) {
    const t = r.test.topic.slice(0, 49).padEnd(50);
    const steps = String(r.tutorial?.steps?.length || 0).padEnd(6);
    const time = (r.eval.time_sec || '?').toString().padEnd(7) + 's';
    console.log(`${t} ${steps} ${time} ${r.eval.pct}%`);
  }

  const avg = Math.round(results.reduce((s, r) => s + r.eval.pct, 0) / results.length);
  const avgTime = (results.reduce((s, r) => s + (r.timings?.total || 0), 0) / results.length / 1000).toFixed(1);
  console.log('-'.repeat(70));
  console.log(`${'AVERAGE'.padEnd(50)} ${' '.repeat(6)} ${avgTime.padEnd(7)}s ${avg}%`);

  // Compare with previous WikiHow-only eval
  console.log(`\n📈 Comparison:`);
  console.log(`   WikiHow only:          53% avg (no narration, no images, 2-3s)`);
  console.log(`   Playwright MCP:        89% avg (real screenshots, 120-180s)`);
  console.log(`   WikiHow + Claude WS:   ${avg}% avg (rich narration, ${avgTime}s)`);

  // Save
  const evalData = results.map(r => ({
    topic: r.test.topic,
    difficulty: r.test.difficulty,
    steps: r.tutorial?.steps?.length || 0,
    url: r.tutorial?.url || null,
    eval: r.eval,
    timings: r.timings,
  }));
  fs.writeFileSync(path.join(OUT_DIR, 'eval-wikihow-claude.json'), JSON.stringify(evalData, null, 2));

  // Save all tutorials
  for (const r of results) {
    if (r.tutorial) {
      const slug = r.test.topic.slice(0, 30).replace(/\s+/g, '-').toLowerCase();
      fs.writeFileSync(path.join(OUT_DIR, `tutorial-${slug}.json`), JSON.stringify(r.tutorial, null, 2));
    }
  }

  console.log(`\n📁 Saved to output/evals/`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
