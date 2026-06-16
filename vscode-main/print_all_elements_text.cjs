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

  const matches = await page.evaluate(() => {
    const list = [];
    document.querySelectorAll('*').forEach(el => {
      const txt = el.textContent?.trim() || '';
      if (txt === 'Compare' || txt === 'Overwrite') {
        list.push({
          tagName: el.tagName,
          className: el.className,
          text: txt,
          id: el.id
        });
      }
    });
    return list;
  });
  console.log('Matches:', matches);

  await browser.close();
}

run().catch(console.error);
