require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();
const topic = process.argv[2] || 'How to create a GitHub repository';
const OUT = path.resolve(__dirname, '..', 'output', 'test-steps');
fs.mkdirSync(OUT, { recursive: true });

// ─── PHASE A: Generate Script ──────────────────────────────────
async function testScript() {
  console.log(`\n══ PHASE A: Script Generation ══`);
  console.log(`Topic: "${topic}"\n`);

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

  console.log(`Title: ${script.title}`);
  console.log(`Intro: "${script.intro}"`);
  console.log(`Outro: "${script.outro}"`);
  console.log(`Steps: ${script.steps.length}\n`);

  script.steps.forEach(s => {
    console.log(`  ${s.step}. ${s.title}`);
    console.log(`     Voice: "${s.description}"`);
    console.log(`     Query: "${s.imageQuery}"`);
    console.log();
  });

  fs.writeFileSync(path.join(OUT, 'script.json'), JSON.stringify(script, null, 2));
  console.log(`→ Saved to ${OUT}/script.json\n`);
  return script;
}

// ─── PHASE B: Test ONE image search + Claude validation ────────
async function testOneImage(step) {
  const query = step.imageQuery || `${step.title} screenshot`;
  console.log(`── Step ${step.step}: "${step.title}" ──`);
  console.log(`   Query: "${query}"`);

  // 1. Serper search
  const res = await fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, gl: 'us', hl: 'en', num: 10 }),
  });

  if (!res.ok) {
    console.log(`   ❌ Serper failed: ${res.status}`);
    return null;
  }

  const data = await res.json();
  const images = (data.images || []).slice(0, 10);
  console.log(`   Serper returned: ${images.length} images`);

  // Show what Serper found
  images.forEach((img, i) => {
    console.log(`     [${i + 1}] ${img.title?.slice(0, 60)} — ${img.imageUrl?.slice(0, 80)}`);
  });

  // 2. Download all
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
      // Only keep JPEG and PNG (Claude supports these reliably)
      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50;
      return isJpeg || isPng;
    })
    .slice(0, 6);

  console.log(`   Downloaded: ${candidates.length}/${images.length} images`);

  if (candidates.length === 0) {
    console.log(`   ❌ No images downloaded\n`);
    return null;
  }

  // Save ALL candidates for inspection
  candidates.forEach((buf, i) => {
    const f = path.join(OUT, `step-${String(step.step).padStart(2, '0')}-candidate-${i + 1}.jpg`);
    fs.writeFileSync(f, buf);
  });
  console.log(`   → Saved ${candidates.length} candidates to ${OUT}/`);

  // 3. Claude Vision picks best
  function detectMime(buf) {
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
    if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
    if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp';
    if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
    return 'image/jpeg';
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
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

Reply with the number (1-${candidates.length}) AND a brief reason why. If none match, say 0 and why.`,
        },
      ],
    }],
  });

  const answer = response.content[0].text.trim();
  console.log(`   Claude says: ${answer}`);

  // Extract first number from response (handles "**4**", "Image 3", "3", etc.)
  const numMatch = answer.match(/\d+/);
  const choice = numMatch ? parseInt(numMatch[0]) - 1 : 0;
  const idx = (choice >= 0 && choice < candidates.length) ? choice : 0;
  const finalFile = path.join(OUT, `step-${String(step.step).padStart(2, '0')}-PICKED.jpg`);
  fs.writeFileSync(finalFile, candidates[idx]);
  console.log(`   → Picked image ${idx + 1} → ${finalFile}\n`);

  return { step: step.step, picked: idx + 1, total: candidates.length, reason: answer };
}

// ─── MAIN ──────────────────────────────────────────────────────
async function main() {
  const script = await testScript();

  console.log(`══ PHASE B: Image Search + Validation (step by step) ══\n`);

  const results = [];
  for (const step of script.steps) {
    const r = await testOneImage(step);
    results.push(r);
  }

  console.log(`\n══ SUMMARY ══`);
  results.forEach((r, i) => {
    if (r) {
      console.log(`  Step ${r.step}: picked ${r.picked}/${r.total}`);
    } else {
      console.log(`  Step ${i + 1}: FAILED`);
    }
  });

  console.log(`\n→ All files in: ${OUT}/`);
  console.log(`→ Open folder: open "${OUT}"`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
