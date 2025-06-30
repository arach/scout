// This script can be used to generate an OG image from the template
// Run: node generate-og.js
// Requires: npm install puppeteer

const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  await page.setViewport({
    width: 1200,
    height: 630,
    deviceScaleFactor: 2,
  });
  
  await page.goto(`file://${path.join(__dirname, 'og-template.html')}`);
  await page.screenshot({
    path: 'og-image.png',
    omitBackground: false,
  });
  
  await browser.close();
  console.log('OG image generated: og-image.png');
})();