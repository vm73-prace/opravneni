import { test, expect } from '@playwright/test';
import { zapniDebugPanel } from './pomocne.mjs';

let chyby;
test.beforeEach(async ({ page }) => {
  zapniDebugPanel(page);
  // Pevné „dnes“, aby ukázková data (počítaná od dneška) i texty s daty byly stejné každý den
  await page.clock.setFixedTime(new Date('2026-11-16T10:00:00+01:00'));
  chyby = [];
  page.on('pageerror', (e) => chyby.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') chyby.push(m.text()); });
});
test.afterEach(() => expect(chyby, 'chyby JS v konzoli').toEqual([]));

async function bezPreteceni(page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, 'stránka přetéká do šířky').toBeLessThanOrEqual(r.cw);
}
const technik = (page, jmeno) => page.locator(`#seznam a.row[data-technik="${jmeno}"]`);
const rgb = async (loc) => (await loc.evaluate((el) => getComputedStyle(el).backgroundColor)).match(/\d+/g).map(Number);

test('přehled: K vyřízení, odznak, řazení a semafor techniků', async ({ page }) => {
  await page.goto('/?demo=1&debug=1');
  await expect(page.locator('#odznak')).toHaveText('4');
  await expect(page.locator('#vyrizeni a.row')).toHaveCount(4);
  // nejdřív propadlé, pak v předstihu, pak objednané po termínu
  const stavy = await page.locator('#vyrizeni a.row .tag').evaluateAll((els) => els.map((e) => e.dataset.stav));
  expect(stavy).toEqual(['propadle', 'predstih', 'predstih', 'objednano']);
  await expect(page.locator('#vyrizeni')).toContainText('termín 14. 11. proběhl – nahraj nový doklad');
  await expect(page.locator('#seznam a.row')).toHaveText([/Petr Svoboda/, /Martin Veselý/, /Jan Dvořák/, /Tomáš Král/, /Lukáš Černý/, /Ondřej Beneš/]);
  const ocek = { 'Petr Svoboda': ['propadle', '1 propadlé · 1 objednané'], 'Martin Veselý': ['predstih', '1 v předstihu'],
    'Tomáš Král': ['objednano', '1 objednané'], 'Lukáš Černý': ['platne', 'vše platné'], 'Ondřej Beneš': ['neurcita', 'doba neurčitá'] };
  for (const [j, [stav, popis]] of Object.entries(ocek)) {
    await expect(technik(page, j)).toHaveAttribute('data-stav', stav);
    await expect(technik(page, j).locator('.sub')).toHaveText(popis);
  }
  // Barvy teček: červená, oranžová, modrá, zelená
  const [r1, g1, b1] = await rgb(technik(page, 'Petr Svoboda').locator('.dot')); expect(r1).toBeGreaterThan(150); expect(g1).toBeLessThan(80); expect(b1).toBeLessThan(80);
  const [r2, g2, b2] = await rgb(technik(page, 'Martin Veselý').locator('.dot')); expect(r2).toBeGreaterThan(g2); expect(g2).toBeGreaterThan(b2);
  const [r3, , b3] = await rgb(technik(page, 'Tomáš Král').locator('.dot')); expect(b3).toBeGreaterThan(r3);
  const [r4, g4, b4] = await rgb(technik(page, 'Lukáš Černý').locator('.dot')); expect(g4).toBeGreaterThan(r4); expect(g4).toBeGreaterThan(b4);
  await expect(page.locator('#debug')).toBeVisible();
  await expect(page.locator('#debug')).not.toHaveClass(/chyba/);
  await expect(page.locator('footer')).toContainText('verze 8');
  await bezPreteceni(page);
});

test('filtr kategorie: technici bez oprávnění zůstanou šedě na konci', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'PPK' }).click();
  await expect(page.locator('#seznam a.row')).toHaveText([/Petr Svoboda/, /Martin Veselý/, /Tomáš Král/, /Jan Dvořák/, /Lukáš Černý/, /Ondřej Beneš/]);
  for (const j of ['Lukáš Černý', 'Ondřej Beneš']) {
    await expect(technik(page, j)).toHaveAttribute('data-stav', 'bez');
    await expect(technik(page, j).locator('.sub')).toHaveText('bez oprávnění');
  }
  await expect(page.locator('#vyrizeni a.row')).toHaveCount(2); // Švadlenka propadlé + Mandík v předstihu
  await page.getByRole('button', { name: 'Elektro' }).click();
  await expect(page.locator('#vyrizeni')).toContainText('Nic k vyřízení');
  await expect(technik(page, 'Petr Svoboda')).toHaveAttribute('data-stav', 'bez');
  await expect(page.locator('#odznak')).toHaveText('4'); // odznak počítá vše
  await bezPreteceni(page);
  await page.getByRole('button', { name: 'Vše' }).click();
  await expect(page.locator('#seznam a.row[data-stav="bez"]')).toHaveCount(0);
});

// Očekávání pro každou kategorii z ukázkového katalogu: pořadí techniků se stavem a počet „K vyřízení“
const KATEGORIE = {
  ppk: { nazev: 'PPK', vyrizeni: 2, technici: [['Petr Svoboda', 'propadle'], ['Martin Veselý', 'predstih'], ['Tomáš Král', 'objednano'], ['Jan Dvořák', 'platne'], ['Lukáš Černý', 'bez'], ['Ondřej Beneš', 'bez']] },
  vyrobci: { nazev: 'Výrobci', vyrizeni: 2, technici: [['Jan Dvořák', 'predstih'], ['Petr Svoboda', 'objednano'], ['Lukáš Černý', 'platne'], ['Tomáš Král', 'platne'], ['Martin Veselý', 'bez'], ['Ondřej Beneš', 'bez']] },
  fplyny: { nazev: 'F-plyny', vyrizeni: 0, technici: [['Martin Veselý', 'platne'], ['Jan Dvořák', 'neurcita'], ['Ondřej Beneš', 'neurcita'], ['Petr Svoboda', 'neurcita'], ['Lukáš Černý', 'bez'], ['Tomáš Král', 'bez']] },
  elektro: { nazev: 'Elektro', vyrizeni: 0, technici: [['Tomáš Král', 'platne'], ['Lukáš Černý', 'platne'], ['Jan Dvořák', 'platne'], ['Martin Veselý', 'bez'], ['Ondřej Beneš', 'bez'], ['Petr Svoboda', 'bez']] }
};
for (const [kod, o] of Object.entries(KATEGORIE)) {
  test(`kategorie ${o.nazev}: odkaz ?kat=${kod}, přehled, detail technika, zapamatování`, async ({ page }) => {
    await page.goto(`/?demo=1&kat=${kod}`);
    await expect(page.getByRole('button', { name: o.nazev, exact: true })).toHaveAttribute('aria-pressed', 'true');
    const radky = page.locator('#seznam a.row');
    await expect(radky).toHaveText(o.technici.map(([j]) => new RegExp(j)));
    expect(await radky.evaluateAll((els) => els.map((e) => e.dataset.stav))).toEqual(o.technici.map(([, s]) => s));
    for (const [j, s] of o.technici) if (s === 'bez') await expect(technik(page, j).locator('.sub')).toHaveText('bez oprávnění');
    await expect(page.locator('#vyrizeni a.row')).toHaveCount(o.vyrizeni);
    await expect(page.locator('#odznak')).toHaveText('4'); // odznak počítá všechny kategorie
    await bezPreteceni(page);
    // Detail technika: jen zvolená kategorie, technik bez oprávnění v ní má šedé „bez oprávnění“
    const [jmenoBez] = o.technici.find(([, s]) => s === 'bez');
    await technik(page, jmenoBez).click();
    await expect(page.getByRole('button', { name: o.nazev, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('section[data-kategorie]')).toHaveCount(1);
    await expect(page.locator(`section[data-kategorie="${kod}"]`)).toContainText('bez oprávnění');
    await bezPreteceni(page);
    // Volba se pamatuje i bez parametru v adrese a adresa ji zase ukazuje
    await page.goto('/?demo=1');
    await expect(page).toHaveURL(new RegExp(`[?&]kat=${kod}`));
    await expect(page.getByRole('button', { name: o.nazev, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Vše', exact: true }).click();
    await expect(page).not.toHaveURL(/kat=/);
    await expect(page.locator('#seznam a.row[data-stav="bez"]')).toHaveCount(0);
  });
}

test('filtr v detailu technika: Vše ukáže všechny kategorie z katalogu, přepnutí platí i pro přehled', async ({ page }) => {
  await page.goto('/?demo=1#/t/t1');
  await expect(page.locator('section[data-kategorie]')).toHaveCount(4);
  await page.getByRole('button', { name: 'F-plyny', exact: true }).click();
  await expect(page.locator('section[data-kategorie]')).toHaveCount(1);
  await expect(page.locator('section[data-kategorie="fplyny"] a.row')).toHaveCount(1);
  await expect(page).toHaveURL(/kat=fplyny#\/t\/t1$/);
  await page.getByRole('link', { name: /Přehled/ }).click();
  await expect(page.getByRole('button', { name: 'F-plyny', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('neznámá kategorie v odkazu = Vše', async ({ page }) => {
  await page.goto('/?demo=1&kat=nesmysl');
  await expect(page.getByRole('button', { name: 'Vše', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).not.toHaveURL(/kat=/);
});

test('bez localStorage filtr funguje v rámci návštěvy', async ({ page }) => {
  await page.addInitScript(() => {
    const vyhod = () => { throw new Error('blokováno'); };
    Object.defineProperty(window, 'localStorage', { get: () => ({ getItem: vyhod, setItem: vyhod }) });
  });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Elektro', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Elektro', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await technik(page, 'Tomáš Král').click();
  await expect(page.locator('section[data-kategorie]')).toHaveCount(1);
});

test('nová kategorie z katalogu se objeví ve filtru a v odkazu', async ({ page }) => {
  await page.goto('/?demo=1#/nastaveni/k/nova');
  await page.locator('#f_nazev').fill('Chlazení');
  await page.locator('#f_id').fill('Chlazení');
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page.locator('#chyba')).toContainText('malých písmen');
  await page.locator('#f_id').fill('chlazeni');
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page.locator('#kategorie a.row[data-kat="chlazeni"]')).toContainText('odkaz ?kat=chlazeni');
  await page.getByRole('link', { name: /Přehled/ }).click();
  await page.getByRole('button', { name: 'Chlazení', exact: true }).click();
  await expect(page.locator('#seznam a.row[data-stav="bez"]')).toHaveCount(6);
  // přepínač je vodorovně posuvný: případné přetečení zůstane uvnitř něj, ne na stránce
  expect(await page.locator('.seg.kat').evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
  await expect(page.getByRole('button', { name: 'Chlazení', exact: true })).toBeInViewport();
  await bezPreteceni(page);
});

test('hledání bez diakritiky', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.locator('#hledat').fill('kral');
  await expect(page.locator('#seznam a.row')).toHaveText([/Tomáš Král/]);
  await page.locator('#hledat').fill('xyz');
  await expect(page.locator('#seznam')).toContainText('Nikdo nenalezen');
  await page.locator('#hledat').fill('');
});

test('detail technika: kategorie, štítky výrobců, náhled dokladu', async ({ page }) => {
  await page.goto('/?demo=1');
  await technik(page, 'Petr Svoboda').click();
  await expect(page.locator('h1')).toHaveText('Petr Svoboda');
  await expect(page.locator('#stav-technika')).toHaveAttribute('data-stav', 'propadle');
  await expect(page.locator('h2')).toHaveText(['PPK', 'Výrobci', 'F-plyny', 'Elektro']);
  const sv = page.locator('a.row[data-druh^="Ing. Švadlenka"]');
  await expect(sv.locator('.chip')).toHaveText(['Mandík', 'Systemair', 'Elektrodesign']);
  await expect(sv.locator('.tag')).toHaveText('propadlé před 10 dny');
  await expect(page.locator('section[data-kategorie="elektro"]')).toContainText('bez oprávnění');
  await expect(page.locator('section[data-kategorie="vyrobci"] .tag')).toHaveText('! termín 14. 11. proběhl – nahraj nový doklad');
  await expect(page.locator('a.row .thumb img').first()).toBeVisible();
  await bezPreteceni(page);
});

test('nové oprávnění: platnost se předvyplní, nahrání fotky se zmenšením', async ({ page }) => {
  await page.goto('/?demo=1#/t/t5');
  await page.getByRole('link', { name: 'Přidat oprávnění' }).click();
  await page.locator('#f_druh_id').selectOption({ label: 'Atrea – VZT jednotky' });
  await expect(page.locator('#f_vydavatel')).toHaveValue('ATREA s.r.o.');
  await page.locator('#f_vydano').fill('2026-03-15');
  await page.locator('#f_vydano').dispatchEvent('change');
  await expect(page.locator('#f_platnost_do')).toHaveValue('2029-03-15'); // + 36 měsíců
  await expect(page.locator('#blokVyrobci')).toBeHidden();
  await page.locator('#f_cislo').fill('ATR-TEST-1');
  // testovací fotka 3000 × 2000 px
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const x = c.getContext('2d'); x.fillStyle = '#4a8fd4'; x.fillRect(0, 0, 3000, 2000); x.fillStyle = '#fff'; x.font = '200px sans-serif'; x.fillText('DOKLAD', 900, 1100);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#f_foto').setInputFiles({ name: 'doklad.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('#vybranySoubor')).toContainText('doklad.png');
  await expect(page.locator('#btnAI')).toBeEnabled();
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page).toHaveURL(/#\/o\//);
  await expect(page.locator('h1')).toHaveText('Atrea – VZT jednotky');
  await expect(page.locator('main > .tag')).toHaveAttribute('data-stav', 'platne');
  const img = page.locator('#nahled');
  await expect(img).toBeVisible();
  const rozmer = await img.evaluate((el) => [el.naturalWidth, el.naturalHeight]);
  expect(rozmer).toEqual([2000, 1333]);
  await bezPreteceni(page);
});

test('nový doklad nahradí aktuální, starší zůstane v historii; PDF nad 10 MB se odmítne', async ({ page }) => {
  await page.goto('/?demo=1#/o/o2/upravit');
  await page.locator('#f_soubor').setInputFiles({ name: 'velky.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.locator('#chyba')).toContainText('větší než 10 MB');
  await page.locator('#f_soubor').setInputFiles({ name: 'novy-certifikat.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page.locator('.doklad')).toContainText('novy-certifikat.pdf');
  await expect(page.locator('#historie a.row')).toHaveCount(1);
});

test('Objednáno na termín: stav zmodrá a zmizí z K vyřízení', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.locator('#vyrizeni a.row[data-vyrizeni="Martin Veselý"]').click();
  await expect(page.locator('main > .tag')).toHaveAttribute('data-stav', 'predstih');
  await page.getByText('Objednáno na termín…').click();
  await page.locator('#f_obj').fill('2026-12-10');
  await page.locator('#f_objp').fill('Praha, rez. č. 55');
  await page.getByRole('button', { name: 'Uložit termín' }).click();
  await expect(page.locator('main > .tag')).toHaveAttribute('data-stav', 'objednano');
  await expect(page.locator('main > .tag')).toHaveText('objednáno · termín 10. 12.');
  await page.getByRole('link', { name: /Martin Veselý/ }).click();
  await page.getByRole('link', { name: /Přehled/ }).click();
  await expect(page.locator('#odznak')).toHaveText('3');
  await expect(page.locator('#vyrizeni a.row[data-vyrizeni="Martin Veselý"]')).toHaveCount(0);
  await expect(technik(page, 'Martin Veselý')).toHaveAttribute('data-stav', 'objednano');
  await bezPreteceni(page);
});

test('technik vidí jen svou sekci a nic needituje', async ({ page }) => {
  await page.goto('/?demo=1&jako=t3');
  await expect(page.locator('h1')).toHaveText('Tomáš Král');
  await expect(page.getByRole('link', { name: 'Upravit' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Přidat oprávnění' })).toHaveCount(0);
  await expect(page.locator('main')).toContainText('Přihlášen jako Tomáš Král (technik)');
  await page.locator('a.row[data-druh="Systemair – požární klapky"]').click();
  await expect(page.getByText('Objednáno na termín…')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Nahrát nový doklad' })).toHaveCount(0);
  // cizí záznam ani nastavení neuvidí
  await page.goto('/?demo=1&jako=t3#/o/o1');
  await expect(page.locator('h1')).toHaveText('Nenalezeno');
  await page.goto('/?demo=1&jako=t3#/nastaveni');
  await expect(page.locator('h1')).toHaveText('Nenalezeno');
  await page.goto('/?demo=1&jako=t3#/t/t1');
  await expect(page.locator('h1')).toHaveText('Tomáš Král');
});

test('nastavení: katalog, předstih, testovací e-mail, přihlášen jako', async ({ page }) => {
  await page.goto('/?demo=1#/nastaveni');
  await expect(page.locator('#prihlasen')).toHaveText('Správce (ukázka)');
  await expect(page.locator('a.row[data-druh]')).toHaveCount(13);
  // testovací e-mail = odkaz na workflow na GitHubu (nová karta) + výsledek posledního testu z logu
  const odkaz = page.getByRole('link', { name: 'Poslat testovací e-mail' });
  await expect(odkaz).toHaveAttribute('href', 'https://github.com/vm73-prace/opravneni/actions/workflows/upozorneni.yml');
  await expect(odkaz).toHaveAttribute('target', '_blank');
  await expect(page.locator('main')).toContainText('Spustí se na GitHubu: Run workflow → režim test. E-mail dorazí do 1–2 min.');
  await expect(page.locator('#posledniTest .kv[data-stav]')).toHaveCount(2);
  await expect(page.locator('#posledniTest .kv[data-stav="ok"]')).toContainText('spravce@example.cz');
  await expect(page.locator('#posledniTest .kv[data-stav="chyba"]')).toContainText('jan.dvorak@example.cz');
  await expect(page.locator('#posledniTest')).toContainText('SMTPRecipientsRefused');
  await expect(page.locator('#posledniTest')).toContainText('15. 11. 2026');
  // změna předstihu druhu Daikin TČ na 30 dní → Jan Dvořák (60 dní) přestane být v předstihu
  await page.locator('a.row[data-druh="Daikin – tepelná čerpadla"]').click();
  await page.locator('#f_predstih_dni').fill('30');
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page.locator('a.row[data-druh="Daikin – tepelná čerpadla"] .sub')).toContainText('předstih 30 dní');
  await page.getByRole('link', { name: /Přehled/ }).click();
  await expect(technik(page, 'Jan Dvořák')).toHaveAttribute('data-stav', 'platne');
  await expect(page.locator('#odznak')).toHaveText('3');
  await bezPreteceni(page);
});

test('nový technik bez účtu se objeví v přehledu šedě', async ({ page }) => {
  await page.goto('/?demo=1#/nastaveni/t/novy');
  await page.locator('#f_jmeno').fill('Zdeněk Nový');
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page.locator('h1')).toHaveText('Zdeněk Nový');
  await page.getByRole('link', { name: /Přehled/ }).click();
  await expect(technik(page, 'Zdeněk Nový')).toHaveAttribute('data-stav', 'bez');
  await expect(page.locator('#seznam a.row').last()).toHaveText(/Zdeněk Nový/);
});

test('Objednáno: doklad s posunutou platností ho zruší, bez posunu se appka zeptá', async ({ page }) => {
  // o8 = Tomáš Král, Systemair, objednáno, platnost za 45 dní
  await page.goto('/?demo=1#/o/o8/upravit');
  await page.locator('#f_soubor').setInputFiles({ name: 'bez-posunu.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page.locator('#dotazObjednani')).toContainText('Zrušit objednání?');
  await expect(page.locator('main > .tag')).toHaveAttribute('data-stav', 'objednano');
  await page.getByRole('button', { name: 'Ponechat' }).click();
  await expect(page.locator('#dotazObjednani')).toHaveCount(0);
  await expect(page.locator('main > .tag')).toHaveAttribute('data-stav', 'objednano');
  await page.getByRole('link', { name: 'Nahrát nový doklad' }).click();
  await page.locator('#f_soubor').setInputFiles({ name: 'novy.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await page.locator('#f_platnost_do').fill('2028-12-31');
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page.locator('#dotazObjednani')).toHaveCount(0);
  await expect(page.locator('main > .tag')).toHaveAttribute('data-stav', 'platne');
  await expect(page.locator('main')).not.toContainText('Objednání');
});

test('debug panel nepřekrývá obsah: odsazení stránky, sbalení se pamatuje', async ({ page }) => {
  await page.goto('/?demo=1&debug=1#/o/o1/upravit');
  const panel = page.locator('#debug');
  await expect(panel).toBeVisible();
  await expect(page.locator('#dbgPrepni')).toHaveText(/Sbalit log/);
  // po doscrollování na konec je poslední tlačítko celé nad panelem
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const smazat = page.getByRole('button', { name: 'Smazat záznam' });
  const [b, p] = [await smazat.boundingBox(), await panel.boundingBox()];
  expect(b.y + b.height).toBeLessThanOrEqual(p.y);
  await smazat.click(); // nejde přes panel → zobrazí potvrzení
  await expect(page.getByRole('button', { name: 'Klepni znovu pro smazání' })).toBeVisible();
  // sbalení: jen štítek, menší odsazení, volba vydrží obnovení stránky
  const vyskaPred = (await panel.boundingBox()).height;
  await page.locator('#dbgPrepni').click();
  await expect(page.locator('#dbgPrepni')).toHaveText(/▸ Log \(\d+\)/);
  await expect(page.locator('#dbgLog')).toBeHidden();
  expect((await panel.boundingBox()).height).toBeLessThan(vyskaPred);
  const odsazeni = await page.evaluate(() => parseInt(document.body.style.paddingBottom, 10));
  expect(odsazeni).toBeGreaterThanOrEqual(Math.round((await panel.boundingBox()).height));
  await page.reload();
  await expect(page.locator('#dbgPrepni')).toHaveText(/▸ Log/);
  await page.locator('#dbgPrepni').click();
  await expect(page.locator('#dbgLog')).toBeVisible();
  await bezPreteceni(page);
});

// ---------- Etapa 5: AI vyčtení (demo = napodobený návrh z demo.js) ----------
const radekAI = (page, pole) => page.locator(`#aiNavrh .ai-radek[data-pole="${pole}"]`);
test('AI vyčtení: zvýraznění rozdílů, převzetí jednoho pole, Převzít vše, zbývá dnes', async ({ page }) => {
  await page.goto('/?demo=1#/o/o5/upravit'); // Petr Svoboda, Švadlenka (více výrobců), má uložený doklad
  const btn = page.locator('#btnAI');
  await expect(btn).toBeEnabled(); // uložený doklad stačí, soubor vybírat nemusí
  await expect(page.locator('#hintAI')).toContainText('jinak uložený doklad');
  await btn.click();
  await expect(btn).toHaveText('Čtu doklad…');
  await expect(btn).toBeDisabled();
  await expect(page.locator('#aiNavrh .ai-radek')).toHaveCount(7);
  await expect(btn).toHaveText('✨ Vyčíst AI');
  await expect(btn).toBeEnabled();
  // shoda: technik, druh, vydavatel; rozdíl: číslo, vydání, platnost, výrobci
  for (const p of ['technik_id', 'druh_id', 'vydavatel']) await expect(radekAI(page, p)).toHaveAttribute('data-rozdil', '0');
  for (const p of ['cislo', 'vydano', 'platnost', 'vyrobci']) {
    await expect(radekAI(page, p)).toHaveAttribute('data-rozdil', '1');
    await expect(radekAI(page, p)).toHaveClass(/rozdil/);
  }
  const [r, , b] = await rgb(radekAI(page, 'cislo')); expect(r).toBeGreaterThan(b); // oranžové pozadí
  await expect(page.locator('#aiNavrh .ai-hlava')).toContainText('Rozdílů: 4');
  await expect(page.locator('#aiZbyva')).toContainText('zbývá dnes 29');
  await expect(radekAI(page, 'cislo').locator('.ai-f')).toHaveText('SV-2024-087');
  await expect(radekAI(page, 'cislo').locator('.ai-a')).toHaveText('DEMO-261102-07');
  // převzetí jednoho pole
  await radekAI(page, 'cislo').getByRole('button', { name: 'Převzít' }).click();
  await expect(page.locator('#f_cislo')).toHaveValue('DEMO-261102-07');
  await expect(radekAI(page, 'cislo')).toHaveAttribute('data-rozdil', '0');
  await expect(page.locator('#f_vydano')).not.toHaveValue('2026-11-02'); // ostatní pole beze změny
  await expect(page.locator('#aiNavrh .ai-hlava')).toContainText('Rozdílů: 3');
  // ruční změna formuláře se v porovnání hned projeví
  await page.locator('#f_vydavatel').fill('Někdo jiný');
  await expect(radekAI(page, 'vydavatel')).toHaveAttribute('data-rozdil', '1');
  // Převzít vše
  await page.getByRole('button', { name: 'Převzít vše' }).click();
  await expect(page.locator('#aiNavrh .ai-radek.rozdil')).toHaveCount(0);
  await expect(page.locator('#aiNavrh .ai-hlava')).toContainText('Formulář odpovídá návrhu');
  await expect(page.locator('#f_vydavatel')).toHaveValue('Ing. Švadlenka');
  await expect(page.locator('#f_vydano')).toHaveValue('2026-11-02');
  await expect(page.locator('#f_platnost_do')).toHaveValue('2028-11-02');
  expect(await page.locator('input[name=vyrobci]:checked').evaluateAll((e) => e.map((x) => x.value))).toEqual(['Mandík', 'Systemair']);
  await bezPreteceni(page);
  // druhé vyčtení sníží zbývající počet
  await btn.click();
  await expect(page.locator('#aiZbyva')).toContainText('zbývá dnes 28');
  // nic se neuloží samo; po Uložit jsou údaje v záznamu
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page).toHaveURL(/#\/o\/o5$/);
  await expect(page.locator('main')).toContainText('DEMO-261102-07');
});

test('AI vyčtení: nové oprávnění – tlačítko až po výběru souboru', async ({ page }) => {
  await page.goto('/?demo=1#/t/t5/nove');
  await expect(page.locator('#btnAI')).toBeDisabled();
  await expect(page.locator('#hintAI')).toContainText('vyber soubor');
  await page.locator('#f_soubor').setInputFiles({ name: 'doklad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await page.locator('#btnAI').click();
  await expect(radekAI(page, 'technik_id')).toHaveAttribute('data-rozdil', '0');
  await expect(radekAI(page, 'druh_id')).toHaveAttribute('data-rozdil', '1'); // ve formuláři druh ještě není
  await page.getByRole('button', { name: 'Převzít vše' }).click();
  await expect(page.locator('#f_druh_id')).not.toHaveValue('');
  await expect(page.locator('#aiNavrh .ai-radek.rozdil')).toHaveCount(0);
});

test('AI vyčtení: technik tlačítko nevidí', async ({ page }) => {
  await page.goto('/?demo=1&jako=t2#/o/o5');
  await expect(page.locator('h1')).toHaveText('Ing. Švadlenka – PBZ více výrobců');
  await expect(page.locator('#btnAI')).toHaveCount(0);
  await page.goto('/?demo=1&jako=t2#/o/o5/upravit');
  await expect(page.locator('h1')).toHaveText('Nenalezeno');
  await expect(page.locator('#btnAI')).toHaveCount(0);
});
