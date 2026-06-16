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

  const results = await page.evaluate(() => {
    const list = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while (node = walk.nextNode()) {
      const text = node.textContent?.trim() || '';
      if (text === 'Compare' || text === 'Overwrite') {
        list.push({
          tagName: node.tagName,
          className: node.className,
          text: text,
          outerHTML: node.outerHTML.slice(0, 200)
        });
      }
    }
    return list;
  });
  console.log('Results:', results);

  await browser.close();
}

run().catch(console.error);
