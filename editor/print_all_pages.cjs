const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  console.log(`Found ${pages.length} pages:`);
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    console.log(`Page ${i}: URL=${p.url()} Title=${await p.title().catch(() => '')}`);
    const text = await p.evaluate(() => document.body.innerText).catch(() => '');
    console.log(`Page ${i} text includes Overwrite:`, text.includes('Overwrite'));
  }
  await browser.close();
}

run().catch(console.error);
