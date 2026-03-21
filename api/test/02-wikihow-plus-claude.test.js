require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();
const OUT_DIR = path.resolve(__dirname, '..', 'output');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

// --- WikiHow fetch (gratis, sin API key) ---
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

// --- Claude API con web search ---
async function enrichWithClaude(topic, wikihowSteps) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{
      role: 'user',
      content: `You are a tutorial video script creator.

Topic: "${topic}"

WikiHow found these steps as a starting reference:
${wikihowSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Your job:
1. Use web search to find the ACTUAL current steps for "${topic}" (WikiHow may be outdated or generic)
2. Create a detailed, accurate step-by-step tutorial based on what you find
3. Each step needs a title and a 2-3 sentence narration (as if narrating a tutorial video)
4. Include the specific URL where the user should go

Return ONLY valid JSON, no markdown, no backticks:
{"title":"...","url":"starting url for this tutorial","source":"where you got the info","steps":[{"step":1,"title":"...","description":"2-3 sentence video narration"}]}`
    }]
  });

  // Extract text from response (may have multiple content blocks due to web search)
  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock?.text || '';
}

async function main() {
  const topic = await ask('🎯 Topic: ');
  rl.close();
  if (!topic.trim()) { console.error('❌ Need topic'); process.exit(1); }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Step 1: WikiHow (free context)
  console.log(`\n🔍 WikiHow search: "${topic}"...`);
  const t0 = Date.now();
  const titles = await searchWikiHow(topic);
  console.log(`   Found ${titles.length} articles`);

  let wikihowSteps = [];
  if (titles.length > 0) {
    // Try top 2 articles, pick the one with more steps
    for (const title of titles.slice(0, 2)) {
      const steps = await getWikiHowSections(title);
      console.log(`   "${title}": ${steps.length} steps`);
      if (steps.length > wikihowSteps.length) wikihowSteps = steps;
    }
  }
  const wikiTime = Date.now() - t0;
  console.log(`   ⏱️  ${wikiTime}ms`);

  if (wikihowSteps.length === 0) {
    wikihowSteps = ['Search for the service', 'Create an account', 'Follow the setup wizard', 'Configure settings', 'Complete the process'];
    console.log('   ⚠️  No WikiHow steps, using generic fallback');
  }

  // Step 2: Claude API + web search (enrichment)
  console.log(`\n🤖 Claude API + web search...`);
  const t1 = Date.now();
  const claudeResponse = await enrichWithClaude(topic, wikihowSteps);
  const claudeTime = Date.now() - t1;
  console.log(`   ⏱️  ${claudeTime}ms`);

  // Parse JSON
  const start = claudeResponse.indexOf('{');
  const end = claudeResponse.lastIndexOf('}');
  if (start === -1 || end === -1) {
    console.error('❌ No JSON from Claude');
    console.log('Raw:', claudeResponse.slice(0, 500));
    process.exit(1);
  }

  let tutorial;
  try {
    tutorial = JSON.parse(claudeResponse.slice(start, end + 1));
  } catch (e) {
    console.error('❌ Bad JSON:', e.message);
    console.log(claudeResponse.slice(start, start + 500));
    process.exit(1);
  }

  // Save
  fs.writeFileSync(path.join(OUT_DIR, 'tutorial.json'), JSON.stringify(tutorial, null, 2));

  // Generate markdown
  const md = [
    `# ${tutorial.title}`,
    ``,
    `> URL: ${tutorial.url || 'N/A'}`,
    `> Source: ${tutorial.source || 'Claude + Web Search'}`,
    ``,
    `---`,
    ``,
  ];
  for (const s of tutorial.steps) {
    md.push(`### Step ${s.step}: ${s.title}`);
    md.push(``);
    md.push(`🎙️ *"${s.description}"*`);
    md.push(``);
    md.push(`---`);
    md.push(``);
  }
  md.push(`*ShowMe AI — WikiHow + Claude Web Search — ${new Date().toISOString().split('T')[0]}*`);
  fs.writeFileSync(path.join(OUT_DIR, 'video-script.md'), md.join('\n'));

  // Eval
  const totalTime = wikiTime + claudeTime;
  const stepCount = tutorial.steps?.length || 0;
  const withDesc = tutorial.steps?.filter(s => s.description?.length > 20).length || 0;

  console.log(`\n📋 ${tutorial.title}`);
  console.log(`   URL: ${tutorial.url || 'N/A'}`);
  tutorial.steps?.forEach(s => console.log(`   ${s.step}. ${s.title}`));

  console.log(`\n📊 Eval:`);
  console.log(`   Steps: ${stepCount} ${stepCount >= 3 && stepCount <= 10 ? '✅' : '⚠️'}`);
  console.log(`   Narration: ${withDesc}/${stepCount} ${withDesc === stepCount ? '✅' : '⚠️'}`);
  console.log(`   WikiHow: ${wikiTime}ms | Claude: ${claudeTime}ms | Total: ${totalTime}ms`);
  console.log(`\n   → output/tutorial.json`);
  console.log(`   → output/video-script.md`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
