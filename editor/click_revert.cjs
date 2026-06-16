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

  console.log('Searching for Revert button element...');
  const revertBtn = page.locator('a:has-text("Revert"), button:has-text("Revert"), .monaco-button:has-text("Revert")').first();
  if (await revertBtn.count() > 0) {
    console.log('Found Revert button! Clicking (force)...');
    await revertBtn.click({ force: true });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(artifactDir, 'settings_revert_completed.png') });
    console.log('Saved settings_revert_completed.png');
  } else {
    console.log('Revert button not found.');
  }

  await browser.close();
}

run().catch(console.error);
