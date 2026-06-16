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

  console.log('Focusing settings.json editor area...');
  const editor = page.locator('[data-uri*="settings.json"] .native-edit-context').first();
  if (await editor.count() > 0) {
    // Let's click it first to make sure it's fully active and focused
    await editor.click({ force: true });
    await page.waitForTimeout(500);

    console.log('Selecting all text (Ctrl+A)...');
    await page.keyboard.press('Control+KeyA');
    await page.waitForTimeout(500);

    console.log('Deleting text...');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    console.log('Typing clean settings...');
    const cleanSettings = `{
    "workbench.colorTheme": "Tomorrow Night Blue",
    "chat.utilityModel": "opengravity/codellama",
    "chat.utilitySmallModel": "opengravity/qwen2.5:0.5b"
}`;
    
    await page.keyboard.type(cleanSettings);
    await page.waitForTimeout(1000);

    console.log('Saving file (Ctrl+S)...');
    await page.keyboard.press('Control+KeyS');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(artifactDir, 'settings_editor_saved.png') });
    console.log('Saved settings_editor_saved.png');
  } else {
    console.log('Editor input area not found!');
  }

  await browser.close();
}

run().catch(console.error);
