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

  // Let's locate the chat textarea
  const chatInput = page.locator('.chat-input-container textarea, [role="textbox"][aria-label*="Chat"], textarea[placeholder*="Describe"], textarea[placeholder*="Ask"]').first();
  if (await chatInput.count() > 0) {
    console.log('Found chat input, focusing...');
    await chatInput.focus();
    await page.waitForTimeout(500);
    
    console.log('Typing message...');
    await page.keyboard.type('tell me a 1-sentence joke');
    await page.waitForTimeout(500);
    
    console.log('Sending message...');
    await page.keyboard.press('Enter');
    
    console.log('Waiting for response...');
    await page.waitForTimeout(10000); // 10 seconds for Ollama loading and generation

    await page.screenshot({ path: path.join(artifactDir, 'ollama_chat_response.png') });
    console.log('Saved ollama_chat_response.png');
  } else {
    console.log('Chat input not found!');
  }

  await browser.close();
}

run().catch(console.error);
