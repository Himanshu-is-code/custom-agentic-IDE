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

  const html = await page.evaluate(() => {
    const el = document.querySelector('.notifications-toasts, .notification-toast-container, .notification-list-item');
    return el ? el.outerHTML : 'Not found';
  });
  console.log('HTML:', html);

  await browser.close();
}

run().catch(console.error);
