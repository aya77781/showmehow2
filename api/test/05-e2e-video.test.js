require('dotenv').config();
const { runResearch, runVideoGeneration } = require('../services/tutorial');

const topic = process.argv[2] || 'How to create a GitHub repository';

function log(event, data) {
  const time = new Date().toLocaleTimeString();
  const info = typeof data === 'object' ? JSON.stringify(data) : data;
  console.log(`  [${time}] ${event}: ${info}`);
}

async function main() {
  console.log(`\n=== ShowMe AI — E2E Test ===`);
  console.log(`Topic: "${topic}"\n`);

  // Phase 1
  console.log('--- Phase 1: Research ---');
  const research = await runResearch(topic, log);
  console.log(`\nResearch done: ${research.tutorial.steps.length} steps, ${research.stats.images} images (${(research.stats.phase1Time / 1000).toFixed(1)}s)`);
  console.log(`Intro: "${research.tutorial.intro}"`);
  console.log(`Outro: "${research.tutorial.outro}"`);
  research.tutorial.steps.forEach(s => console.log(`  ${s.step}. ${s.title} — "${s.description}"`));

  // Phase 2
  console.log('\n--- Phase 2: Video Generation ---');
  const video = await runVideoGeneration(
    research.sessionId,
    research.tutorial.steps,
    research.tutorial,
    log
  );

  console.log(`\n=== RESULT ===`);
  console.log(`Clips: ${video.clips}`);
  console.log(`Final: ${video.finalVideo || 'NONE'} (${(video.finalVideoSize / 1024 / 1024).toFixed(1)}MB)`);
  console.log(`Time: ${(video.time / 1000).toFixed(1)}s`);
  if (video.finalVideo) {
    console.log(`\nOpen: open output/sessions/${research.sessionId}/final-video.mp4`);
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
