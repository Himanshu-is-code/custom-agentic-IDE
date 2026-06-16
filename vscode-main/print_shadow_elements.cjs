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
    function scan(node) {
      if (!node) return;
      
      const txt = node.textContent?.trim() || '';
      if (txt === 'Compare' || txt === 'Overwrite') {
        list.push({
          tagName: node.tagName,
          className: node.className,
          text: txt,
          outerHTML: node.outerHTML ? node.outerHTML.slice(0, 200) : ''
        });
      }

      // Scan children
      if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
          scan(node.children[i]);
        }
      }

      // Scan shadow root
      if (node.shadowRoot) {
        scan(node.shadowRoot);
      }
    }
    scan(document.body);
    return list;
  });
  console.log('Shadow elements matches:', results);

  await browser.close();
}

run().catch(console.error);
