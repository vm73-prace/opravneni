// Smoke test proti nasazené appce (bez přihlášení, nic neukládá):
//   node tests/smoke-ostry.mjs [adresa]   (výchozí https://vm73-prace.github.io/opravneni/)
// Kontroluje: HTTP 200, přihlašovací obrazovku, service worker, manifest + ikony, „verze N“ (z app.js) v ukázce,
// žádné chyby v konzoli ani neúspěšné požadavky na vlastní původ. Exit 1 při chybě.
import { chromium, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

const base = (process.argv[2] || 'https://vm73-prace.github.io/opravneni/').replace(/\/?$/, '/');
const verze = Number(/var VERZE = (\d+);/.exec(readFileSync(new URL('../app.js', import.meta.url), 'utf8'))[1]);
const chyby = [];
const ok = (podminka, text) => { console.log((podminka ? 'ok    ' : 'CHYBA ') + text); if (!podminka) chyby.push(text); };

const b = await chromium.launch({ channel: 'chrome' });
for (const [nazev, zarizeni] of [['iPhone 13', devices['iPhone 13']], ['PC 1280', { viewport: { width: 1280, height: 800 } }]]) {
  console.log(`\n== ${nazev}`);
  const ctx = await b.newContext({ ...zarizeni, locale: 'cs-CZ', timezoneId: 'Europe/Prague' });
  const p = await ctx.newPage();
  const konzole = [], selhane = [];
  p.on('console', (m) => { if (m.type() === 'error') konzole.push(m.text()); });
  p.on('pageerror', (e) => konzole.push(e.message));
  p.on('response', (r) => { if (r.url().startsWith(base) && r.status() >= 400) selhane.push(r.status() + ' ' + r.url()); });

  const r = await p.goto(base, { waitUntil: 'networkidle' });
  ok(r.status() === 200, `HTTP ${r.status()} ${base}`);
  ok(await p.locator('input[type=email]').isVisible() && await p.locator('input[type=password]').isVisible(), 'přihlašovací formulář (e-mail + heslo)');

  const sw = await p.evaluate(async () => { const reg = await navigator.serviceWorker.ready; return reg.active && reg.active.scriptURL; });
  ok(sw === base + 'sw.js', `service worker aktivní: ${sw}`);
  const cache = await p.evaluate(() => caches.keys());
  ok(cache.includes('opravneni-v' + verze), `cache ${cache.join(', ')}`);

  const man = await p.evaluate(async () => { const a = document.querySelector('link[rel=manifest]').href; const m = await (await fetch(a)).json(); return { a, m }; });
  ok(man.a === base + 'manifest.json', `manifest ${man.a}`);
  ok(new URL(man.m.start_url, man.a).href === base && new URL(man.m.scope, man.a).href === base, `start_url a scope = ${base}`);
  for (const i of man.m.icons) {
    const u = new URL(i.src, man.a).href;
    const s = await p.evaluate(async (u) => { const x = await fetch(u); return x.status + ' ' + x.headers.get('content-type'); }, u);
    ok(s === '200 image/png', `ikona ${i.sizes} ${i.purpose}: ${s}`);
  }
  for (const sel of ['link[rel=apple-touch-icon]', 'link[rel=icon]']) {
    const s = await p.evaluate(async (sel) => { const x = await fetch(document.querySelector(sel).href); return x.status; }, sel);
    ok(s === 200, `${sel}: ${s}`);
  }

  await p.goto(base + '?demo=1', { waitUntil: 'networkidle' });
  const pata = (await p.locator('footer').first().textContent()) || '';
  ok(pata.includes('verze ' + verze + ' · demo'), `patička ukázky: „${pata.trim()}“`);

  ok(konzole.length === 0, `konzole bez chyb${konzole.length ? ': ' + konzole.join(' | ') : ''}`);
  ok(selhane.length === 0, `žádný neúspěšný požadavek${selhane.length ? ': ' + selhane.join(' | ') : ''}`);
  await ctx.close();
}
await b.close();
console.log(chyby.length ? `\n${chyby.length} chyb` : '\nvše v pořádku');
process.exit(chyby.length ? 1 : 0);
