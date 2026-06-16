const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

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

  // Let's close the current editor (which has the dirty corrupt settings.json)
  // We can do this by running F1 -> "View: Close Editor"
  console.log('Closing the active settings.json editor...');
  await page.keyboard.press('F1');
  await page.waitForTimeout(1000);
  await page.keyboard.type('View: Close Editor');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  
  // If there's a prompt asking to save changes or not, we choose "Don't Save"
  // "Don't Save" is typically triggered by pressing Escape or Alt+N or clicking.
  // In VS Code, when closing a dirty file, it shows a dialog where "Don't Save" is usually the first option or we can press 'Tab' then 'Enter' or 'd'.
  // Let's wait a bit and press the key combination for "Don't Save" (e.g. Escape or 'Tab' then 'Enter' or 'ArrowRight' then 'Enter').
  // Let's just click 'Don't Save' natively if it's there.
  await page.waitForTimeout(2000);
  
  console.log('Pressing Tab + Enter for Don\'t Save dialog...');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);

  // Take a screenshot to see if it closed
  await page.screenshot({ path: path.join(artifactDir, 'settings_fixed.png') });
  console.log('Saved settings_fixed.png');

  await browser.close();
}

run().catch(console.error);
