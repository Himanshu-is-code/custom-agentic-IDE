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
    document.querySelectorAll('.monaco-editor, [role="textbox"], textarea').forEach(el => {
      list.push({
        tagName: el.tagName,
        className: el.className,
        role: el.getAttribute('role') || '',
        outerHTML: el.outerHTML.slice(0, 150)
      });
    });
    return list;
  });
  console.log(JSON.stringify(elements, null, 2));

  await browser.close();
}

run().catch(console.error);
