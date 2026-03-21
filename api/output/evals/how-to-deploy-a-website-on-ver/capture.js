const { chromium } = require('playwright');
const path = require('path');

const outputDir = '/Users/santiagogarcia/Documents/GitHub/HackatonApp/api/output/evals/how-to-deploy-a-website-on-ver/images';

async function screenshot(page, step) {
  const filename = path.join(outputDir, `step-${String(step).padStart(2, '0')}.png`);
  await page.screenshot({ path: filename, fullPage: true });
  console.log(`Saved: ${filename}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  // Step 01 - Vercel homepage
  console.log('Step 01: Navigate to vercel.com');
  await page.goto('https://vercel.com', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await screenshot(page, 1);

  // Step 02 - Sign up page
  console.log('Step 02: Go to sign up page');
  try {
    await page.goto('https://vercel.com/signup', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('Timeout on signup, taking screenshot anyway');
  }
  await screenshot(page, 2);

  // Step 03 - New project / import
  console.log('Step 03: New project page');
  try {
    await page.goto('https://vercel.com/new', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('Timeout on /new, taking screenshot anyway');
  }
  await screenshot(page, 3);

  // Step 04 - Project settings domains (simulate with docs or dashboard)
  console.log('Step 04: Domains settings (using docs)');
  try {
    await page.goto('https://vercel.com/docs/projects/domains/add-a-domain', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('Timeout, taking screenshot anyway');
  }
  await screenshot(page, 4);

  // Step 05 - DNS settings docs
  console.log('Step 05: DNS / Nameservers docs');
  try {
    await page.goto('https://vercel.com/docs/projects/domains/nameservers', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('Timeout, taking screenshot anyway');
  }
  await screenshot(page, 5);

  // Step 06 - Domain registrar info (using Vercel docs on external DNS)
  console.log('Step 06: Update domain registrar settings');
  try {
    await page.goto('https://vercel.com/docs/projects/domains/working-with-dns', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('Timeout, taking screenshot anyway');
  }
  await screenshot(page, 6);

  // Step 07 - HTTPS / verify domain docs
  console.log('Step 07: Verify domain and HTTPS');
  try {
    await page.goto('https://vercel.com/docs/security/ssl', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('Timeout, taking screenshot anyway');
  }
  await screenshot(page, 7);

  await browser.close();
  console.log('SCREENSHOTS_COMPLETE');
})();
