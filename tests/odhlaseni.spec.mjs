// Odhlášení jen tohoto zařízení a vždy úspěšné (verze 10).
// Samostatný soubor bez page.clock.setFixedTime: opakování obnovy tokenu v supabase-js měří skutečný čas.
import { test, expect } from '@playwright/test';
import { mockSupabase, vychoziStore, UCTY, HESLO } from './supabase-mock.mjs';
import { zapniDebugPanel } from './pomocne.mjs';

const KLIC = 'opravneni-auth';
const OFFLINE = 'odhlášení offline – session smazána jen lokálně';
test.describe.configure({ mode: 'parallel', timeout: 90000 });

let chyby, zaznamy, ocekavane, zadrzene;
function sleduj(page) {
  zapniDebugPanel(page);
  page.on('pageerror', (e) => chyby.push(e.message));
  page.on('console', (m) => { zaznamy.push(m.text()); if (m.type() === 'error') chyby.push(m.text()); });
}
test.beforeEach(({ page }) => {
  chyby = []; zaznamy = []; ocekavane = null; zadrzene = [];
  sleduj(page);
});
test.afterEach(() => {
  zadrzene.forEach((pust) => pust());
  expect(chyby.filter((c) => !(ocekavane && ocekavane.test(c))), 'chyby JS v konzoli').toEqual([]);
});

const VYPADEK = /Failed to load resource|výpadek|Failed to fetch|Server přihlášení|Nejde se spojit|knihovnu Supabase/;
function zadrz() {
  let pust;
  const ceka = new Promise((res) => { pust = res; });
  zadrzene.push(pust);
  return { ceka, pust };
}
function vypni(store, porucha) {
  const co = porucha === 'bez odpovědi' ? zadrz().ceka : porucha;
  for (const sluzba of ['token', 'logout', 'user']) store.selhani[sluzba] = co;
}
const ulozena = (page) => page.evaluate((k) => localStorage.getItem(k), KLIC);
async function blokujUloziste(page, metody, zpusob = 'tise') {
  const blokuj = ({ metody, zpusob }) => metody.forEach((m) => {
    const puvodni = Storage.prototype[m];
    Storage.prototype[m] = function () {
      if (this !== window.localStorage) return puvodni.apply(this, arguments);
      if (zpusob === 'vyjimka') throw new DOMException('blokováno', 'SecurityError');
    };
  });
  await page.addInitScript(blokuj, { metody, zpusob });
  await page.evaluate(blokuj, { metody, zpusob });
}
async function prihlas(page) {
  await page.locator('#f_email').fill(UCTY.spravce.email);
  await page.locator('#f_heslo').fill(HESLO);
  await page.getByRole('button', { name: 'Přihlásit' }).click();
}
async function prihlaseny(page, store = vychoziStore()) {
  await mockSupabase(page, store);
  await page.goto('/');
  await prihlas(page);
  await expect(page.locator('#vyrizeni')).toBeVisible();
  await expect.poll(() => ulozena(page)).toContain('access_token');
  return store;
}
async function vyprsiToken(page) { // v paměti i v localStorage, stránka zůstává otevřená
  await page.evaluate((k) => {
    const s = JSON.parse(authStorage.getItem(k));
    s.expires_at = Math.floor(Date.now() / 1000) - 60;
    authStorage.setItem(k, JSON.stringify(s));
  }, KLIC);
  await expect.poll(async () => JSON.parse(await ulozena(page)).expires_at).toBeLessThan(Date.now() / 1000);
}
async function klepniOdhlasit(page) {
  await page.evaluate(() => { location.hash = '#/nastaveni'; });
  await page.getByRole('button', { name: 'Odhlásit' }).click();
}
async function odhlasBezServeru(page) {
  await klepniOdhlasit(page);
  await expect(page.locator('#f_email')).toBeVisible({ timeout: 9000 }); // limit 5 s + rezerva na pomalém PC
  await expect.poll(() => zaznamy.filter((t) => t.includes(OFFLINE)).length).toBe(1);
}
async function zustavaOdhlaseny(page, store) {
  await page.reload();
  await expect(page.locator('#f_email')).toBeVisible();
  store.selhani = {}; store.neplatna = null; // server zase běží a sezení na něm může dál platit
  await page.reload();
  await expect(page.locator('#f_email')).toBeVisible();
  await expect(page.locator('#vyrizeni')).toHaveCount(0);
}

// ---------- (a) jen toto zařízení ----------
test('(a) odhlášení na jednom zařízení neodhlásí druhé', async ({ page, browser }) => {
  const store = await prihlaseny(page);
  const ctx2 = await browser.newContext();
  const druhe = await ctx2.newPage();
  sleduj(druhe);
  await prihlaseny(druhe, store);

  await klepniOdhlasit(page);
  await expect(page.locator('#f_email')).toBeVisible();
  await page.reload();
  await expect(page.locator('#f_email')).toBeVisible();

  await druhe.reload();
  await expect(druhe.locator('#vyrizeni')).toBeVisible();
  // projde i obnova tokenu, ne jen dosud platný JWT
  expect(await druhe.evaluate(async () => (await sb.auth.refreshSession()).error)).toBeNull();
  expect(store.rozsahy).toEqual(['local']);
  expect(store.sezeni.size).toBe(1);
  await ctx2.close();
});

// ---------- (b) vypršený token a nedostupný server ----------
for (const porucha of [503, 'sit', 429, 'bez odpovědi']) {
  test(`(b) vypršený token a nedostupný server (${porucha}): odhlásí a po F5 zůstane`, async ({ page }) => {
    ocekavane = VYPADEK;
    const store = await prihlaseny(page);
    await vyprsiToken(page);
    vypni(store, porucha);
    await odhlasBezServeru(page);
    await expect.poll(() => ulozena(page)).toBeNull();
    await zustavaOdhlaseny(page, store);
  });
}

for (const blokace of [null, 'tise', 'vyjimka']) {
  test(`(b) dvě záložky${blokace ? ', blokované mazání (' + blokace + ')' : ''}: odhlášení offline platí v obou`, async ({ page, context }) => {
    ocekavane = VYPADEK;
    const store = await prihlaseny(page);
    const zalozka = await context.newPage();
    sleduj(zalozka);
    await zalozka.goto('/');
    await expect(zalozka.locator('#vyrizeni')).toBeVisible();
    await vyprsiToken(zalozka); // má session i ve své paměti, jako po obnově tokenu
    await vyprsiToken(page);
    vypni(store, 'sit');
    if (blokace) await blokujUloziste(page, ['removeItem'], blokace);
    await odhlasBezServeru(page);
    await expect(zalozka.locator('#f_email')).toBeVisible();
    store.selhani = {};
    expect(await zalozka.evaluate(async () => (await sb.auth.getSession()).data.session)).toBeNull();
    await zalozka.reload();
    await expect(zalozka.locator('#f_email')).toBeVisible();
    await zustavaOdhlaseny(page, store);
  });
}

// ---------- (c) totéž s blokovaným mazáním ----------
for (const zpusob of ['tise', 'vyjimka']) {
  for (const porucha of [503, 'sit', 'bez odpovědi']) {
    test(`(c) vypršený token, nedostupný server (${porucha}) a blokované mazání (${zpusob}): po F5 odhlášený`, async ({ page }) => {
      ocekavane = VYPADEK;
      const store = await prihlaseny(page);
      await vyprsiToken(page);
      vypni(store, porucha);
      await blokujUloziste(page, ['removeItem'], zpusob);
      await odhlasBezServeru(page);
      await expect.poll(() => ulozena(page)).toBe(''); // přepsáno prázdnou hodnotou
      await zustavaOdhlaseny(page, store);
    });
  }
}

for (const porucha of [500, 'sit', 'bez odpovědi']) {
  test(`platný token a nedostupný server (${porucha}): odhlásí a zapíše to do logu`, async ({ page }) => {
    ocekavane = VYPADEK;
    const store = await prihlaseny(page);
    vypni(store, porucha);
    await odhlasBezServeru(page);
    await zustavaOdhlaseny(page, store);
  });
}

test('odhlášení offline je vidět v debug panelu', async ({ page }) => {
  ocekavane = VYPADEK;
  const store = await prihlaseny(page);
  await page.goto('/?debug=1');
  await expect(page.locator('#vyrizeni')).toBeVisible();
  store.selhani.logout = 'sit';
  await klepniOdhlasit(page);
  await expect(page.locator('#f_email')).toBeVisible();
  await expect(page.locator('#dbgLog')).toContainText(OFFLINE);
});

test('obnova tokenu doběhne až po odhlášení: session se nevrátí', async ({ page }) => {
  const store = await prihlaseny(page);
  await vyprsiToken(page);
  const z = zadrz();
  store.selhani.token = z.ceka;
  await odhlasBezServeru(page);
  const odpoved = page.waitForResponse(/\/auth\/v1\/token/);
  z.pust();
  await odpoved;
  expect(await page.evaluate(async () => (await sb.auth.getSession()).data.session)).toBeNull();
  await zustavaOdhlaseny(page, store);
});

// ---------- nové přihlášení a opožděné odpovědi ----------
for (const sluzba of ['token', 'logout']) {
  test(`nové přihlášení počká na nedokončené odhlášení (${sluzba}) a to ho nesmaže`, async ({ page }) => {
    const store = await prihlaseny(page);
    if (sluzba === 'token') await vyprsiToken(page);
    const z = zadrz();
    store.selhani[sluzba] = z.ceka;
    await odhlasBezServeru(page);
    delete store.selhani[sluzba]; // další požadavky už server vyřídí hned
    await prihlas(page);
    await expect(page.locator('#chyba')).toContainText('Dokončuji předchozí odhlášení');
    await page.waitForTimeout(500); // čas, ve kterém by nové přihlášení předběhlo staré odhlášení
    await expect(page.locator('#vyrizeni')).toHaveCount(0);
    z.pust();
    await expect(page.locator('#vyrizeni')).toBeVisible();
    await page.waitForTimeout(300); // doběhne staré odhlášení i odložený zápis
    await page.reload();
    await expect(page.locator('#vyrizeni')).toBeVisible();
  });
}

test('opožděné odhlášení v jedné záložce nesmaže nové přihlášení z druhé', async ({ page, context }) => {
  const store = await prihlaseny(page);
  const z = zadrz();
  store.selhani.logout = z.ceka;
  await odhlasBezServeru(page);
  const zalozka = await context.newPage();
  sleduj(zalozka);
  await zalozka.goto('/');
  await prihlas(zalozka);
  await expect(zalozka.locator('#vyrizeni')).toBeVisible();
  await expect.poll(() => ulozena(zalozka)).toContain('access_token');
  z.pust();
  await page.waitForTimeout(500); // doběhne staré odhlášení i odložené mazání
  await zalozka.reload();
  await expect(zalozka.locator('#vyrizeni')).toBeVisible();
});

test('přihlášení počká i na ověření sezení ze startu: odmítnutí starého ho nesmaže', async ({ page }) => {
  ocekavane = /Failed to load resource.*403/;
  const store = await prihlaseny(page);
  const z = zadrz();
  store.selhani.user = z.ceka;
  const dotaz = page.waitForRequest(/\/auth\/v1\/user/);
  await page.reload();
  await dotaz;
  await page.evaluate((k) => { // odhlášeno v jiné záložce, zatímco tato ještě ověřuje sezení
    localStorage.removeItem(k);
    dispatchEvent(new StorageEvent('storage', { key: k, newValue: null }));
  }, KLIC);
  await expect(page.locator('#f_email')).toBeVisible();
  store.sezeni.clear();
  delete store.selhani.user;
  await prihlas(page);
  await page.waitForTimeout(300);
  z.pust();
  await expect(page.locator('#vyrizeni')).toBeVisible();
  await page.reload();
  await expect(page.locator('#vyrizeni')).toBeVisible();
});

// ---------- (d) neplatná session při startu ----------
for (const kod of ['bad_jwt', 'user_not_found', 'user_banned']) {
  for (const blokace of [false, true]) {
    test(`(d) ${kod} při startu${blokace ? ', blokované mazání' : ''}: session zahozena jen na tomto zařízení`, async ({ page }) => {
      ocekavane = VYPADEK;
      const store = await prihlaseny(page);
      if (blokace) await blokujUloziste(page, ['removeItem']);
      store.neplatna = kod;
      await page.reload();
      await expect(page.locator('#f_email')).toBeVisible();
      await expect.poll(() => ulozena(page)).toBe(blokace ? '' : null);
      expect(store.rozsahy).not.toContain('global');
      await zustavaOdhlaseny(page, store);
    });
  }
}

// ---------- (e) obrazovka výpadku při startu ----------
const zkusitZnovu = (page) => page.getByRole('button', { name: 'Zkusit znovu' });
async function odhlasZVypadku(page) {
  await page.getByRole('button', { name: 'Odhlásit' }).click();
  await expect(page.locator('#f_email')).toBeVisible({ timeout: 9000 });
}

for (const porucha of [500, 'sit']) {
  test(`(e) vypršený token a výpadek při startu (${porucha}): hláška, Odhlásit a po F5 odhlášený`, async ({ page }) => {
    ocekavane = VYPADEK;
    const store = await prihlaseny(page);
    await vyprsiToken(page);
    vypni(store, porucha);
    await page.reload();
    await expect(zkusitZnovu(page)).toBeVisible({ timeout: 40000 }); // supabase-js zkouší obnovu až 30 s
    await expect(page.getByRole('alert')).toContainText('Přihlášení zůstává uložené');
    await expect(page.locator('#f_email')).toHaveCount(0);
    await page.evaluate(() => { location.hash = '#/nastaveni'; }); // změna adresy hlášku nenahradí
    await expect(zkusitZnovu(page)).toBeVisible();
    await odhlasZVypadku(page);
    await zustavaOdhlaseny(page, store);
  });
}

test('(e) vypršený token a výpadek při startu: po obnově serveru Zkusit znovu přihlášení vrátí', async ({ page }) => {
  ocekavane = VYPADEK;
  const store = await prihlaseny(page);
  await vyprsiToken(page);
  vypni(store, 503);
  await page.reload();
  await expect(zkusitZnovu(page)).toBeVisible({ timeout: 40000 });
  store.selhani = {};
  await zkusitZnovu(page).click();
  await expect(page.locator('#vyrizeni')).toBeVisible();
});

for (const odhlasit of [true, false]) {
  test(`(e) start bez odpovědi serveru: hláška, ${odhlasit ? 'Odhlásit funguje' : 'po odpovědi se appka načte sama'}`, async ({ page }) => {
    const store = await prihlaseny(page);
    await vyprsiToken(page);
    await page.clock.install();
    const z = zadrz();
    store.selhani.token = z.ceka;
    const dotaz = page.waitForRequest(/\/auth\/v1\/token/);
    await page.reload();
    await dotaz;
    await page.clock.fastForward(36000);
    await expect(zkusitZnovu(page)).toBeVisible();
    if (odhlasit) {
      await odhlasZVypadku(page);
      z.pust(); // opožděná odpověď session nevrátí ani nepřekreslí přihlášení
      await page.waitForTimeout(300);
      await expect(page.locator('#f_email')).toBeVisible();
      await zustavaOdhlaseny(page, store);
    } else {
      z.pust();
      await expect(page.locator('#vyrizeni')).toBeVisible();
    }
  });
}

test('(e) výpadek dat při startu: Odhlásit a po F5 odhlášený', async ({ page }) => {
  ocekavane = VYPADEK;
  const store = await prihlaseny(page);
  vypni(store, 'sit');
  store.selhani.rest = 'sit';
  await page.reload();
  await expect(zkusitZnovu(page)).toBeVisible({ timeout: 15000 });
  await odhlasZVypadku(page);
  await zustavaOdhlaseny(page, store);
});

test('(e) nenačtená knihovna: Odhlásit smaže session i bez ní', async ({ page }) => {
  ocekavane = VYPADEK;
  const store = await prihlaseny(page);
  const cdn = /cdn\.jsdelivr\.net/, vypadekCdn = (r) => r.abort('connectionfailed');
  await page.route(cdn, vypadekCdn);
  await page.reload();
  await expect(zkusitZnovu(page)).toBeVisible();
  await odhlasZVypadku(page);
  await prihlas(page);
  await expect(page.locator('#chyba')).toContainText('obnov stránku');
  await page.reload();
  await expect(zkusitZnovu(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Odhlásit' })).toHaveCount(0); // není koho odhlásit
  await page.unroute(cdn, vypadekCdn);
  await zustavaOdhlaseny(page, store);
});
