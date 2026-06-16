const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('workbench-dev.html'));
  if (!page) {
    console.error('Workbench page not found!');
    await browser.close();
    return;
  }

  const text = await page.evaluate(() => document.body.innerText);
  console.log('Body Text includes Overwrite:', text.includes('Overwrite'));
  console.log('Body Text length:', text.length);
  // Log first 1000 characters and last 1000 characters
  console.log('Start:', text.slice(0, 500));
  console.log('End:', text.slice(-500));

  await browser.close();
}

run().catch(console.error);
