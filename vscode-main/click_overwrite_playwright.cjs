const { chromium } = require('playwright');
const path = require('path');

async function run() {
  console.log('Connecting to Electron via CDP...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('workbench-dev.html'));
  if (!page) {
    console.error('Workbench page not found!');
    await browser.close();
    return;
  }

  const artifactDir = 'C:\\Users\\hx117\\.gemini\\antigravity\\brain\\f5b56202-daaa-45e7-a5bf-17dfb8fd4234\\artifacts';

  console.log('Searching for Overwrite button element...');
  const overwriteBtn = page.locator('a:has-text("Overwrite"), button:has-text("Overwrite"), .monaco-button:has-text("Overwrite")').first();
  if (await overwriteBtn.count() > 0) {
    console.log('Found Overwrite button! Clicking (force)...');
    await overwriteBtn.click({ force: true });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(artifactDir, 'settings_overwrite_completed.png') });
    console.log('Saved settings_overwrite_completed.png');
  } else {
    console.log('Overwrite button not found.');
  }

  await browser.close();
}

run().catch(console.error);
