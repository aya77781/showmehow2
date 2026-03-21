require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { fal } = require('@fal-ai/client');
const cheerio = require('cheerio');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();
fal.config({ credentials: process.env.FAL_KEY });

const OUT_DIR = path.resolve(__dirname, '..', 'output');
const IMG_DIR = path.join(OUT_DIR, 'images');
const VID_DIR = path.join(OUT_DIR, 'videos');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

// ═══════════════════════════════════════════════════════════════
// Phase 1A: WikiHow — scrape full article page with cheerio
// ═══════════════════════════════════════════════════════════════
async function getWikiHowArticle(query) {
  const searchRes = await fetch(
    `https://www.wikihow.com/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`
  );
  const searchData = await searchRes.json();
  const titles = searchData.query.search.map(r => r.title);
  if (titles.length === 0) return null;

  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const scored = titles.map(t => ({
    title: t,
    score: queryWords.filter(w => t.toLowerCase().includes(w)).length,
  }));
  scored.sort((a, b) => b.score - a.score);

  const minScore = Math.max(1, Math.ceil(queryWords.length * 0.4));
  if (scored[0].score < minScore) return null;

  const bestTitle = scored[0].title;
  const articleUrl = `https://www.wikihow.com/${bestTitle.replace(/\s+/g, '-')}`;

  const pageRes = await fetch(articleUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
  });
  const html = await pageRes.text();
  const $ = cheerio.load(html);

  const steps = [];
  $('li[id^="step-id-"]').each((i, el) => {
    const stepEl = $(el);
    const title = stepEl.find('b.whb').first().text().trim();
    if (!title) return;

    let imageUrl = null;
    stepEl.find('script[type="application/json"]').each((_, scriptEl) => {
      try {
        const data = JSON.parse($(scriptEl).html());
        imageUrl = data.bigUrl || data.smallUrl || null;
      } catch {}
    });

    if (!imageUrl) {
      const srcset = stepEl.find('picture source[media="(min-width: 729px)"]').last().attr('srcset');
      if (srcset) imageUrl = srcset.split(/\s/)[0];
    }
    if (!imageUrl) {
      const imgSrc = stepEl.find('picture img').attr('src');
      if (imgSrc && !imgSrc.includes('Icon')) imageUrl = imgSrc;
    }
    if (imageUrl && !imageUrl.startsWith('http')) {
      imageUrl = 'https://www.wikihow.com' + imageUrl;
    }

    steps.push({ title, imageUrl });
  });

  return { title: bestTitle, url: articleUrl, steps };
}

// ═══════════════════════════════════════════════════════════════
// Phase 1B: Download WikiHow images
// ═══════════════════════════════════════════════════════════════
async function downloadImages(steps) {
  let count = 0;
  for (let i = 0; i < steps.length; i++) {
    if (!steps[i].imageUrl) continue;
    try {
      const res = await fetch(steps[i].imageUrl);
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 3000) continue;
      const ext = steps[i].imageUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || 'jpg';
      const file = `step-${String(i + 1).padStart(2, '0')}.${ext}`;
      fs.writeFileSync(path.join(IMG_DIR, file), buffer);
      steps[i].localFile = file;
      steps[i].fileSize = buffer.length;
      count++;
    } catch {}
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════
// Phase 1C: Claude API + web search → narration script
// ═══════════════════════════════════════════════════════════════
async function generateScript(topic, wikiSteps) {
  const limitedSteps = wikiSteps.slice(0, 8);
  const stepsContext = limitedSteps.length > 0
    ? limitedSteps.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
    : 'No steps found, use web search to find them.';

  const targetSteps = Math.min(Math.max(limitedSteps.length, 5), 8);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages: [{
      role: 'user',
      content: `Tutorial video script for: "${topic}"

Reference steps:
${stepsContext}

Create ${targetSteps} steps. Each step: title + 1 SHORT sentence narration (max 15 words, for a 2-3 second video clip). Include starting URL.

Return ONLY valid JSON, no markdown:
{"title":"...","url":"...","steps":[{"step":1,"title":"...","description":"..."}]}`
    }]
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
  const i = text.indexOf('{'), j = text.lastIndexOf('}');
  if (i === -1) throw new Error('No JSON from Claude');
  return JSON.parse(text.slice(i, j + 1));
}

// ═══════════════════════════════════════════════════════════════
// Phase 2: Upload image to fal.ai storage
// ═══════════════════════════════════════════════════════════════
async function uploadImage(filePath) {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const blob = new Blob([buffer], { type: mimeTypes[ext] || 'image/jpeg' });
  return await fal.storage.upload(blob);
}

// ═══════════════════════════════════════════════════════════════
// Phase 2: Generate video for one step — VEED Fabric 1.0 (text-to-video)
// ═══════════════════════════════════════════════════════════════
async function generateStepVideo(step, imageFile, index) {
  const imgPath = path.join(IMG_DIR, imageFile);
  if (!fs.existsSync(imgPath)) return null;

  const imageUrl = await uploadImage(imgPath);
  const narration = (step.description || step.title).slice(0, 100);

  const result = await fal.subscribe('veed/fabric-1.0/text', {
    input: {
      image_url: imageUrl,
      text: narration,
      resolution: '480p',
    },
    onQueueUpdate(update) {
      if (update.status === 'IN_QUEUE') {
        process.stdout.write(`\r   📹 Step ${index + 1}: queued (pos ${update.position || '?'})...`);
      } else if (update.status === 'IN_PROGRESS') {
        process.stdout.write(`\r   📹 Step ${index + 1}: generating...                    `);
      }
    },
  });

  process.stdout.write(`\r   ✅ Step ${index + 1}: done                                \n`);

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) return null;

  // Download video file
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) return null;
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
  const videoFile = `step-${String(index + 1).padStart(2, '0')}.mp4`;
  fs.writeFileSync(path.join(VID_DIR, videoFile), videoBuffer);

  return { file: videoFile, size: videoBuffer.length, url: videoUrl };
}

// ═══════════════════════════════════════════════════════════════
// Phase 2: Generate all step videos (batched concurrency)
// ═══════════════════════════════════════════════════════════════
async function generateAllVideos(tutorial, wikiSteps) {
  const jobs = [];

  for (let i = 0; i < tutorial.steps.length; i++) {
    if (wikiSteps[i]?.localFile) {
      jobs.push({ step: tutorial.steps[i], imageFile: wikiSteps[i].localFile, index: i });
    }
  }

  if (jobs.length === 0) {
    console.log('   ⚠️  No images available for video generation');
    return [];
  }

  console.log(`   🎬 Generating ${jobs.length} videos (all parallel)...\n`);

  // All in parallel
  const results = await Promise.all(
    jobs.map(({ step, imageFile, index }) =>
      generateStepVideo(step, imageFile, index).catch(err => {
        console.log(`   ❌ Step ${index + 1}: ${err.message}`);
        if (err.body?.detail) console.log(`      ${err.body.detail}`);
        return null;
      })
    )
  );

  return results;
}

// ═══════════════════════════════════════════════════════════════
// Main Pipeline
// ═══════════════════════════════════════════════════════════════
async function main() {
  const topic = await ask('🎯 Topic: ');
  rl.close();
  if (!topic.trim()) { console.error('❌ Need topic'); process.exit(1); }

  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(VID_DIR, { recursive: true });

  const t0 = Date.now();

  // ── Phase 1: WikiHow scrape + Claude narration + image download ──
  console.log(`\n⚡ Phase 1: Content & Images\n`);

  const wikiData = await getWikiHowArticle(topic);
  if (wikiData) {
    console.log(`   ✅ WikiHow: "${wikiData.title}" — ${wikiData.steps.length} steps (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } else {
    console.log(`   ⚠️  WikiHow: no results (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  const wikiSteps = wikiData?.steps || [];

  const [tutorial, imgCount] = await Promise.all([
    generateScript(topic, wikiSteps).then(result => {
      console.log(`   ✅ Claude: ${result.steps.length} steps (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      return result;
    }),
    downloadImages(wikiSteps).then(count => {
      console.log(`   ✅ Images: ${count} downloaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      return count;
    }),
  ]);

  const phase1Time = Date.now() - t0;

  // Match WikiHow images to Claude steps
  for (let i = 0; i < tutorial.steps.length; i++) {
    if (wikiSteps[i]?.localFile) {
      tutorial.steps[i].screenshot = wikiSteps[i].localFile;
    }
  }

  console.log(`\n   Phase 1 complete: ${tutorial.steps.length} steps, ${imgCount} images (${(phase1Time / 1000).toFixed(1)}s)`);

  // ── Phase 2: Video generation with VEED Fabric 1.0 ──
  console.log(`\n🎬 Phase 2: Video Generation (VEED Fabric 1.0)\n`);
  const t1 = Date.now();

  const videoResults = await generateAllVideos(tutorial, wikiSteps);
  const phase2Time = Date.now() - t1;
  const successVideos = videoResults.filter(Boolean);

  // Attach video info to tutorial steps
  for (let i = 0; i < videoResults.length; i++) {
    if (videoResults[i]) {
      // Find the matching tutorial step by the job index
      const jobIndex = (() => {
        let count = 0;
        for (let j = 0; j < tutorial.steps.length; j++) {
          if (wikiSteps[j]?.localFile) {
            if (count === i) return j;
            count++;
          }
        }
        return -1;
      })();
      if (jobIndex >= 0) {
        tutorial.steps[jobIndex].video = videoResults[i].file;
        tutorial.steps[jobIndex].videoSize = videoResults[i].size;
      }
    }
  }

  console.log(`\n   Phase 2 complete: ${successVideos.length}/${videoResults.length} videos (${(phase2Time / 1000).toFixed(1)}s)`);

  const totalTime = Date.now() - t0;

  // ── Save outputs ──
  tutorial.source = wikiData ? `WikiHow — ${wikiData.title}` : 'Claude Web Search';
  tutorial.wikiUrl = wikiData?.url || null;
  fs.writeFileSync(path.join(OUT_DIR, 'tutorial.json'), JSON.stringify(tutorial, null, 2));

  // Generate markdown with images + video links
  const md = [`# ${tutorial.title}\n`, `> URL: ${tutorial.url}\n`];
  if (tutorial.wikiUrl) md.push(`> Source: [${tutorial.source}](${tutorial.wikiUrl})\n`);
  md.push(`---\n`);
  for (const s of tutorial.steps) {
    md.push(`### Step ${s.step}: ${s.title}\n`);
    if (s.screenshot) md.push(`![Step ${s.step}](images/${s.screenshot})\n`);
    if (s.video) md.push(`🎥 [Watch video](videos/${s.video})\n`);
    md.push(`🎙️ *"${s.description}"*\n`);
    md.push(`---\n`);
  }
  md.push(`*ShowMe AI — ${new Date().toISOString().split('T')[0]}*`);
  fs.writeFileSync(path.join(OUT_DIR, 'video-script.md'), md.join('\n'));

  // ── Summary ──
  const withImgs = tutorial.steps.filter(s => s.screenshot).length;
  const withVids = tutorial.steps.filter(s => s.video).length;
  const totalVideoMB = (successVideos.reduce((sum, v) => sum + (v?.size || 0), 0) / 1024 / 1024).toFixed(1);

  console.log(`\n━━━ RESULT ━━━`);
  console.log(`📋 ${tutorial.title}`);
  console.log(`🌐 ${tutorial.url}`);
  if (wikiData) console.log(`📚 ${tutorial.source}`);
  tutorial.steps.forEach(s =>
    console.log(`   ${s.step}. ${s.title} ${s.screenshot ? '🖼️' : '  '} ${s.video ? '🎥' : ''}`)
  );
  console.log(`\n   ${tutorial.steps.length} steps | ${withImgs} images | ${withVids} videos (${totalVideoMB}MB)`);
  console.log(`   ⏱️  Phase 1: ${(phase1Time / 1000).toFixed(1)}s | Phase 2: ${(phase2Time / 1000).toFixed(1)}s | Total: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`   → output/tutorial.json`);
  console.log(`   → output/video-script.md`);
  console.log(`   → output/images/`);
  console.log(`   → output/videos/`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
