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

  const elements = await page.evaluate(() => {
    const list = [];
    document.querySelectorAll('*').forEach(el => {
      const txt = el.textContent?.trim() || '';
      if (txt.length > 0 && txt.length < 50) {
        list.push({
          tagName: el.tagName,
          className: el.className,
          text: txt
        });
      }
    });
    return list;
  });
  console.log(JSON.stringify(elements.filter(e => e.text.includes('Overwrite') || e.text.includes('Compare')), null, 2));

  await browser.close();
}

run().catch(console.error);
