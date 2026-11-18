// Vyrenderuje SVG ikony do PNG přes Chrome: node icons/render.mjs [A|B|C]
// Bez argumentu vytvoří jen náhled icons/nahled.png; s písmenem vyrobí sadu ikon do kořene repa.
import { chromium } from '@playwright/test';
import { readFileSync, copyFileSync } from 'node:fs';
const dir = new URL('./', import.meta.url), root = new URL('../', import.meta.url);
const svg = (k) => 'data:image/svg+xml;base64,' + readFileSync(new URL(k + '.svg', dir)).toString('base64');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const vyber = process.argv[2];
if (!vyber) {
  const karta = (k) => `<figure><img src="${svg(k)}" width="220" height="220" style="border-radius:50px"><img src="${svg(k)}" width="60" height="60" style="border-radius:14px;margin-left:16px"><figcaption>${k}</figcaption></figure>`;
  await page.setViewportSize({ width: 960, height: 320 });
  await page.setContent(`<body style="margin:0;display:flex;gap:24px;padding:24px;background:#f2f2f7;font:600 32px -apple-system,Segoe UI,sans-serif">${['A', 'B', 'C'].map(karta).join('')}</body><style>figure{margin:0;display:flex;align-items:flex-end;flex-wrap:wrap;width:296px}figcaption{width:100%;text-align:center;margin-top:8px}</style>`);
  await page.screenshot({ path: new URL('nahled.png', dir).pathname.slice(1) });
} else {
  for (const [name, size] of [['icon-1024.png', 1024], ['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0"><img src="${svg(vyber)}" width="${size}" height="${size}" style="display:block"></body>`);
    await page.screenshot({ path: new URL(name, root).pathname.slice(1) });
  }
  // Symbol leží v bezpečné zóně (do 40 % poloměru), maskable je proto stejný obrázek
  copyFileSync(new URL('icon-512.png', root), new URL('icon-512-maskable.png', root));
}
await browser.close();
