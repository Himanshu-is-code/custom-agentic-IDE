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

  console.log('Reloading page...');
  await page.reload();
  await page.waitForTimeout(6000);

  // Close the welcome page if open or any settings editor
  // Let's run a force-reload command: View: Reopen Editor With Text Editor or just reload again.
  console.log('Taking a screenshot after reload...');
  await page.screenshot({ path: path.join(artifactDir, 'reloaded_state.png') });
  console.log('Saved reloaded_state.png');

  await browser.close();
}

run().catch(console.error);
