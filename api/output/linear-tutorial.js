const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = '/Users/santiagogarcia/Documents/GitHub/HackatonApp/api/output/images';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function screenshot(page, step) {
  const filename = path.join(OUTPUT_DIR, `step-${String(step).padStart(2, '0')}.png`);
  await page.screenshot({ path: filename, fullPage: false });
  console.log(`Saved: ${filename}`);
  return filename;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  let step = 1;

  // Step 1: Navigate to signup page
  console.log('Navigating to linear.app/signup...');
  await page.goto('https://linear.app/signup', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);
  await screenshot(page, step++);

  // Step 2: Scroll down to see more options
  await page.evaluate(() => window.scrollTo(0, 300));
  await sleep(1000);
  await screenshot(page, step++);

  // Step 3: Try clicking "Continue with email" or email input
  const emailInput = await page.$('input[type="email"], input[placeholder*="email"], input[name="email"]');
  if (emailInput) {
    await emailInput.click();
    await emailInput.fill('demo@example.com');
    await sleep(1000);
    await screenshot(page, step++);
  } else {
    // Look for "Continue with email" button
    const emailBtn = await page.$('button:has-text("email"), [data-testid*="email"], a:has-text("email")');
    if (emailBtn) {
      await emailBtn.click();
      await sleep(2000);
      await screenshot(page, step++);
    } else {
      // Just screenshot current state with Google/GitHub buttons visible
      await screenshot(page, step++);
    }
  }

  // Step 4: Look for Google/GitHub OAuth buttons
  const googleBtn = await page.$('button:has-text("Google"), a:has-text("Google"), [aria-label*="Google"]');
  const githubBtn = await page.$('button:has-text("GitHub"), a:has-text("GitHub"), [aria-label*="GitHub"]');

  if (googleBtn || githubBtn) {
    const btn = googleBtn || githubBtn;
    await btn.hover();
    await sleep(500);
    await screenshot(page, step++);
  }

  // Step 5: Navigate to the main linear.app page
  await page.goto('https://linear.app', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);
  await screenshot(page, step++);

  // Step 6: Scroll down on main page to show features
  await page.evaluate(() => window.scrollTo(0, 600));
  await sleep(1000);
  await screenshot(page, step++);

  // Step 7: Go back to signup and show the full form
  await page.goto('https://linear.app/signup', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await screenshot(page, step++);

  await browser.close();
  console.log(`\nDone! Captured ${step - 1} screenshots.`);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
