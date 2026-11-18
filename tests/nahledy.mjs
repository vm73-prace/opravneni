// Screenshoty obrazovek (iPhone 13) do složky nahledy/ ke kontrole v chatu: node tests/nahledy.mjs (běžící server na 8124)
import { chromium, devices } from '@playwright/test';
const b = await chromium.launch({ channel: 'chrome' });
const base = 'http://localhost:8124/';
const shots = [
  ['1-prehled', '?demo=1', 'light'], ['2-filtr-ppk', '?demo=1', 'light', async (p) => p.getByRole('button', { name: 'PPK' }).click()],
  ['3-technik', '?demo=1#/t/t2', 'light'], ['4-zaznam-po-terminu', '?demo=1#/o/o7', 'light'],
  ['5-formular', '?demo=1#/o/o5/upravit', 'light'], ['6-nastaveni', '?demo=1#/nastaveni', 'light'],
  ['7-pohled-technika', '?demo=1&jako=t3', 'light'], ['8-prehled-tmavy', '?demo=1', 'dark']
];
for (const [n, u, scheme, akce] of shots) {
  const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme: scheme, locale: 'cs-CZ', timezoneId: 'Europe/Prague' });
  const p = await ctx.newPage();
  await p.goto(base + u); await p.waitForTimeout(250);
  if (akce) { await akce(p); await p.waitForTimeout(150); }
  await p.screenshot({ path: `nahledy/${n}.png`, fullPage: true });
  await ctx.close();
}
await b.close();
