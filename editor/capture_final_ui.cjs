const { chromium } = require('playwright');
const path = require('path');

async function run() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('workbench-dev.html'));
  if (!page) {
    console.error('Workbench page not found!');
    await browser.close();
    return;
  }

  const artifactDir = 'C:\\Users\\hx117\\.gemini\\antigravity\\brain\\f5b56202-daaa-45e7-a5bf-17dfb8fd4234\\artifacts';
  await page.waitForTimeout(5000); // Wait 5 more seconds
  await page.screenshot({ path: path.join(artifactDir, 'reloaded_state_loaded.png') });
  console.log('Saved reloaded_state_loaded.png');

  await browser.close();
}

run().catch(console.error);
