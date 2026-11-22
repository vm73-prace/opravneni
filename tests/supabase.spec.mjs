// Ostrý režim (bez ?demo) proti napodobenému Supabase: přihlášení, role, ukládání, schéma opravneni, odhlášení.
import { test, expect } from '@playwright/test';
import { mockSupabase, vychoziStore, UCTY, HESLO } from './supabase-mock.mjs';
import { zapniDebugPanel } from './pomocne.mjs';

let chyby, ocekavane;
test.beforeEach(async ({ page }) => {
  zapniDebugPanel(page);
  await page.clock.setFixedTime(new Date('2026-11-16T10:00:00+01:00'));
  chyby = []; ocekavane = null;
  page.on('pageerror', (e) => chyby.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') chyby.push(m.text()); });
});
// 400 ze špatného hesla prohlížeč hlásí jako „Failed to load resource“ – to je očekávané
test.afterEach(() => expect(chyby.filter((c) => !/Failed to load resource.*400/.test(c) && !(ocekavane && ocekavane.test(c))), 'chyby JS v konzoli').toEqual([]));

async function prihlas(page, ucet, heslo = HESLO) {
  await page.locator('#f_email').fill(ucet.email);
  await page.locator('#f_heslo').fill(heslo);
  await page.getByRole('button', { name: 'Přihlásit' }).click();
}
async function bezPreteceni(page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, 'stránka přetéká do šířky').toBeLessThanOrEqual(r.cw);
}

test('správce: přihlášení, technik, oprávnění, Objednáno, nastavení, kategorie, obnovení stránky, odhlášení', async ({ page }) => {
  const { store, hlavicky } = await mockSupabase(page);
  await page.goto('/?debug=1');
  await expect(page.locator('h1')).toHaveText('Oprávnění');
  await expect(page.locator('.banner')).toHaveCount(0); // žádný ukázkový banner
  await bezPreteceni(page);

  await prihlas(page, UCTY.spravce, 'spatne');
  await expect(page.locator('#chyba')).toContainText('Špatný e-mail nebo heslo');
  await prihlas(page, UCTY.spravce);
  await expect(page.locator('#vyrizeni')).toContainText('Nic k vyřízení');
  await expect(page.getByRole('button', { name: 'Elektro', exact: true })).toBeVisible(); // kategorie z DB

  // nový technik
  await page.goto('/#/nastaveni/t/novy');
  await page.locator('#f_jmeno').fill('Karel Zkušební');
  await page.locator('#f_email').fill('karel@example.cz');
  await expect(page.locator('#ucet')).toHaveText('ne');
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page.locator('h1')).toHaveText('Karel Zkušební');
  expect(store.technici).toHaveLength(1);
  expect(store.technici[0]).toMatchObject({ jmeno: 'Karel Zkušební', email: 'karel@example.cz', aktivni: true });
  expect(store.technici[0]).not.toHaveProperty('ucet');

  // nové oprávnění: platnost se předvyplní podle lhůty druhu; doklady zatím nejsou
  await page.getByRole('link', { name: 'Přidat oprávnění' }).click();
  await page.locator('#f_druh_id').selectOption({ label: 'Mandík – požární klapky' });
  await page.locator('#f_vydano').fill('2025-01-10');
  await page.locator('#f_vydano').dispatchEvent('change');
  await expect(page.locator('#f_platnost_do')).toHaveValue('2027-01-10');
  await page.locator('#f_platnost_do').fill('2026-12-20'); // podle dokladu – v předstihu
  await page.locator('#f_cislo').fill('MAN-1');
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page.locator('main > .tag')).toHaveAttribute('data-stav', 'predstih');
  expect(store.opravneni[0]).toMatchObject({ technik_id: store.technici[0].id, druh_id: 'd-mandik', cislo: 'MAN-1', vydano: '2025-01-10', platnost_do: '2026-12-20', vydavatel: 'MANDÍK, a.s.', neurcita: false });

  // Objednáno na termín
  await page.getByText('Objednáno na termín…').click();
  await page.locator('#f_obj').fill('2026-12-05');
  await page.locator('#f_objp').fill('Praha, rez. 7');
  await page.getByRole('button', { name: 'Uložit termín' }).click();
  await expect(page.locator('main > .tag')).toHaveText('objednáno · termín 5. 12.');
  expect(store.opravneni[0]).toMatchObject({ objednano_na: '2026-12-05', objednano_pozn: 'Praha, rez. 7' });

  // nastavení a kategorie
  await page.goto('/#/nastaveni');
  await expect(page.locator('#prihlasen')).toHaveText('spravce@example.cz – správce');
  await page.locator('#f_predstih_dni').fill('60');
  await page.locator('#f_prijemci').fill('spravce@example.cz');
  await page.getByRole('button', { name: 'Uložit', exact: true }).click();
  await expect(page.locator('#zprava')).toHaveText('Uloženo.');
  expect(store.nastaveni[0]).toMatchObject({ predstih_dni: 60, prijemci: 'spravce@example.cz' });
  await page.goto('/#/nastaveni/k/nova');
  await page.locator('#f_nazev').fill('Chlazení');
  await page.locator('#f_id').fill('chlazeni');
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page.locator('#kategorie a.row[data-kat="chlazeni"]')).toBeVisible();
  // duplicitní kód z databáze → srozumitelná chyba
  await page.goto('/#/nastaveni/k/nova');
  await page.locator('#f_nazev').fill('Znovu');
  await page.locator('#f_id').fill('chlazeni');
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page.locator('#chyba')).toContainText('už existuje');

  // obnovení stránky: zůstane přihlášený a data se načtou z DB
  await page.goto('/?kat=ppk');
  await expect(page.locator('#seznam a.row[data-technik="Karel Zkušební"]')).toHaveAttribute('data-stav', 'objednano');
  await expect(page.getByRole('button', { name: 'Chlazení', exact: true })).toBeVisible();
  expect(new Set(hlavicky)).toEqual(new Set(['opravneni'])); // všechny dotazy jen do schématu opravneni
  await expect(page.locator('#debug')).not.toHaveClass(/chyba/);

  // odhlášení
  await page.goto('/#/nastaveni');
  await page.getByRole('button', { name: 'Odhlásit' }).click();
  await expect(page.locator('#f_email')).toBeVisible();
});

test('technik: vidí jen svou sekci, stav počítá s globálním předstihem, nic needituje', async ({ page }) => {
  const store = vychoziStore();
  store.technici.push({ id: 't-moje', jmeno: 'Jiří Technik', email: '', aktivni: true }, { id: 't-cizi', jmeno: 'Cizí Technik', email: '', aktivni: true });
  store.uzivatele.push({ user_id: UCTY.technik.id, role: 'technik', technik_id: 't-moje' });
  store.opravneni.push(
    // 150 dní do konce: s globálním předstihem 200 je v předstihu
    { id: 'o-moje', technik_id: 't-moje', druh_id: 'd-mandik', cislo: 'M1', vydavatel: '', vydano: '2025-04-15', platnost_do: '2027-04-15', neurcita: false, vyrobci: [], predstih_dni: null, objednano_na: null, objednano_pozn: '', poznamka: '', bez_dokladu: false },
    { id: 'o-cizi', technik_id: 't-cizi', druh_id: 'd-mandik', cislo: 'C1', vydavatel: '', vydano: '2024-01-01', platnost_do: '2026-01-01', neurcita: false, vyrobci: [], predstih_dni: null, objednano_na: null, objednano_pozn: '', poznamka: '', bez_dokladu: false }
  );
  store.nastaveni[0].predstih_dni = 200;
  store.nastaveni[0].prijemci = 'tajny-spravce@example.cz';
  await mockSupabase(page, store);
  await page.goto('/');
  await prihlas(page, UCTY.technik);
  await expect(page.locator('h1')).toHaveText('Jiří Technik');
  await expect(page.locator('#prihlasen')).toContainText('technik@example.cz – Jiří Technik (technik)');
  await expect(page.locator('a.row[data-druh="Mandík – požární klapky"] .tag')).toHaveAttribute('data-stav', 'predstih');
  await expect(page.locator('main')).not.toContainText('Cizí');
  await expect(page.getByRole('link', { name: 'Upravit' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Přidat oprávnění' })).toHaveCount(0);
  await page.goto('/#/nastaveni');
  await expect(page.locator('h1')).toHaveText('Nenalezeno');
  await page.goto('/#/o/o-cizi');
  await expect(page.locator('h1')).toHaveText('Nenalezeno');
  await page.goto('/#/o/o-moje');
  await expect(page.getByText('Objednáno na termín…')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('tajny-spravce');
  await bezPreteceni(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Odhlásit' }).click();
  await expect(page.locator('#f_email')).toBeVisible();
});

test('účet bez přístupu k appce vidí jen hlášku a odhlášení', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await prihlas(page, UCTY.bez);
  await expect(page.locator('#bezPristupu')).toContainText('nemá přístup k appce Oprávnění');
  await expect(page.locator('#seznam')).toHaveCount(0);
  await page.getByRole('button', { name: 'Odhlásit' }).click();
  await expect(page.locator('#f_email')).toBeVisible();
});

test('odkaz na ukázku z přihlašovací obrazovky', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Otevřít ukázku' }).click();
  await expect(page.locator('.banner')).toContainText('Ukázkový režim');
});

// ---------- Etapa 3: doklady ve Storage ----------
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const zaznam = (id, technik, extra = {}) => ({ id, technik_id: technik, druh_id: 'd-mandik', cislo: 'M-' + id, vydavatel: '', vydano: '2024-12-01', platnost_do: '2026-12-01',
  neurcita: false, vyrobci: [], predstih_dni: null, objednano_na: null, objednano_pozn: '', poznamka: '', bez_dokladu: false, ...extra });
function storeSDoklady() {
  const store = vychoziStore();
  store.technici.push({ id: 't-k', jmeno: 'Karel Doklad', email: '', aktivni: true }, { id: 't-cizi', jmeno: 'Cizí Technik', email: '', aktivni: true });
  store.uzivatele.push({ user_id: UCTY.technik.id, role: 'technik', technik_id: 't-k' });
  // v předstihu a objednané po termínu → nový doklad stav Objednáno zruší
  store.opravneni.push(zaznam('o1', 't-k', { objednano_na: '2026-11-10', objednano_pozn: 'Praha' }), zaznam('o2', 't-cizi'));
  return store;
}
async function testovaciFotka(page, w = 3000, h = 2000) {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#4a8fd4'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.font = '200px sans-serif'; x.fillText('DOKLAD', 900, 1100);
    return c.toDataURL('image/png').split(',')[1];
  }, [w, h]);
  return { name: 'doklad.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

test('doklady: fotka se zmenší a nahraje do složky technika, PDF ji nahradí, historie, podepsané URL, smazání i se soubory', async ({ page }) => {
  const { store } = await mockSupabase(page, storeSDoklady());
  await page.goto('/?debug=1'); // panel nesmí překrývat spodní tlačítka
  await prihlas(page, UCTY.spravce);
  await expect(page.locator('#vyrizeni')).toBeVisible(); // přihlášení dokončené a uložené
  await page.goto('/#/o/o1');
  await expect(page.locator('main > .tag')).toHaveAttribute('data-stav', 'objednano');
  await page.getByRole('link', { name: 'Nahrát nový doklad' }).click();
  await page.locator('#f_foto').setInputFiles(await testovaciFotka(page));
  await expect(page.locator('#vybranySoubor')).toContainText('doklad.png');
  await page.locator('#f_platnost_do').fill('2028-12-01'); // nový doklad posouvá platnost → Objednáno se zruší
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page).toHaveURL(/#\/o\/o1$/);
  await expect(page.locator('#nahled')).toBeVisible();
  expect(await page.locator('#nahled').evaluate((el) => [el.naturalWidth, el.naturalHeight])).toEqual([2000, 1333]);
  // Storage: složka technika, JPEG, zmenšený; řádek dokladu; Objednáno zrušené
  const [cesta] = Object.keys(store.soubory);
  expect(cesta).toMatch(/^t-k\/[0-9a-f-]{36}\.jpg$/);
  expect(store.soubory[cesta].typ).toBe('image/jpeg');
  expect(store.soubory[cesta].body.length).toBeGreaterThan(1000);
  expect(store.soubory[cesta].body.length).toBeLessThan(600 * 1024);
  expect(store.doklady).toHaveLength(1);
  expect(store.doklady[0]).toMatchObject({ opravneni_id: 'o1', technik_id: 't-k', path: cesta, typ: 'image/jpeg', aktualni: true, velikost: store.soubory[cesta].body.length });
  expect(store.opravneni.find((o) => o.id === 'o1')).toMatchObject({ objednano_na: null, objednano_pozn: '', platnost_do: '2028-12-01' });
  await expect(page.locator('main > .tag')).toHaveAttribute('data-stav', 'platne');
  await expect(page.locator('#dotazObjednani')).toHaveCount(0);
  await expect(page.locator('#debug')).not.toHaveClass(/chyba/);

  // po obnovení stránky se náhled načte přes podepsanou URL ze Storage
  await page.reload();
  const src = await page.locator('#nahled').getAttribute('src');
  expect(src).toMatch(/^https:\/\/pqehuuamgecmdmrdhmza\.supabase\.co\/storage\/v1\/object\/sign\/opravneni-doklady\/t-k\/.+\.jpg\?token=/);
  await expect.poll(() => page.locator('#nahled').evaluate((el) => el.naturalWidth)).toBe(2000);
  await expect(page.getByRole('link', { name: 'Otevřít doklad' })).toHaveAttribute('href', src);

  // nový doklad (PDF) nahradí fotku, fotka zůstane v historii
  await page.getByRole('link', { name: 'Nahrát nový doklad' }).click();
  await page.locator('#f_soubor').setInputFiles({ name: 'osvedceni-2026.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page.locator('.doklad')).toContainText('osvedceni-2026.pdf');
  await expect(page.locator('#historie a.row')).toHaveCount(1);
  expect(store.doklady.filter((d) => d.aktualni).map((d) => d.typ)).toEqual(['application/pdf']);
  expect(Object.keys(store.soubory)).toHaveLength(2);
  await page.reload();
  await expect(page.locator('#historie a.row')).toHaveAttribute('href', /\/storage\/v1\/object\/sign\/opravneni-doklady\/t-k\/.+\.jpg\?token=/);
  await expect(page.locator('.doklad .thumb.pdf')).toBeVisible();

  // smazání záznamu smaže řádky dokladů i soubory
  await page.goto('/#/o/o1/upravit');
  await page.getByRole('button', { name: 'Smazat záznam' }).click();
  await page.getByRole('button', { name: 'Klepni znovu pro smazání' }).click();
  await expect(page).toHaveURL(/#\/t\/t-k$/);
  await expect.poll(() => Object.keys(store.soubory).length).toBe(0);
  expect(store.doklady).toHaveLength(0);
  await bezPreteceni(page);
});

test('doklady: když zápis do DB selže, nahraný soubor se uklidí a předchozí doklad zůstane aktuální', async ({ page }) => {
  const store = storeSDoklady();
  store.soubory['t-k/puvodni.jpg'] = { body: PNG1, typ: 'image/png' };
  store.doklady.push({ id: 'k-puv', opravneni_id: 'o1', technik_id: 't-k', path: 't-k/puvodni.jpg', typ: 'image/jpeg', nazev: 'foto-dokladu.jpg', velikost: PNG1.length, aktualni: true, nahrano: '2026-01-05T10:00:00Z' });
  store.selhani.doklady = true;
  await mockSupabase(page, store);
  await page.goto('/');
  await prihlas(page, UCTY.spravce);
  await expect(page.locator('#vyrizeni')).toBeVisible(); // přihlášení dokončené a uložené
  await page.goto('/#/o/o1/upravit');
  await page.locator('#f_soubor').setInputFiles({ name: 'novy.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page.locator('#chyba')).toContainText('Uložení selhalo');
  await expect(page.locator('#chyba')).toContainText('doklad ne');
  await expect(page.getByRole('button', { name: 'Uložit' }).last()).toBeEnabled();
  await expect.poll(() => Object.keys(store.soubory)).toEqual(['t-k/puvodni.jpg']);
  expect(store.doklady).toEqual([expect.objectContaining({ id: 'k-puv', aktualni: true })]);
  expect(store.opravneni.find((o) => o.id === 'o1').objednano_na).toBe('2026-11-10'); // Objednáno zůstává
  // chybu zápisu prohlížeč i appka hlásí do konzole – v tomto testu očekávané
  chyby = chyby.filter((c) => !/Failed to load resource/.test(c) && !/Hodnota nesplňuje|check constraint/.test(c));
});

test('doklady: technik vidí svůj doklad přes podepsanou URL, cizí ne, nahrávat nemůže', async ({ page }) => {
  const store = storeSDoklady();
  store.soubory['t-k/muj.jpg'] = { body: PNG1, typ: 'image/png' };
  store.soubory['t-cizi/cizi.jpg'] = { body: PNG1, typ: 'image/png' };
  store.doklady.push(
    { id: 'k1', opravneni_id: 'o1', technik_id: 't-k', path: 't-k/muj.jpg', typ: 'image/jpeg', nazev: 'foto-dokladu.jpg', velikost: 1, aktualni: true, nahrano: '2026-01-05T10:00:00Z' },
    { id: 'k2', opravneni_id: 'o2', technik_id: 't-cizi', path: 't-cizi/cizi.jpg', typ: 'image/jpeg', nazev: 'foto-dokladu.jpg', velikost: 1, aktualni: true, nahrano: '2026-01-05T10:00:00Z' });
  await mockSupabase(page, store);
  await page.goto('/');
  await prihlas(page, UCTY.technik);
  await expect(page.locator('a.row .thumb img')).toHaveAttribute('src', /object\/sign\/opravneni-doklady\/t-k\/muj\.jpg\?token=/);
  await expect.poll(() => page.locator('a.row .thumb img').evaluate((el) => el.naturalWidth)).toBe(1);
  await page.goto('/#/o/o1');
  await expect(page.locator('#nahled')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nahrát nový doklad' })).toHaveCount(0);
  await page.goto('/#/o/o1/upravit');
  await expect(page.locator('h1')).toHaveText('Nenalezeno');
  // technik nemá k dispozici cizí doklady ani jejich podepsané URL
  expect(await page.evaluate(() => S.doklady.map((k) => k.path))).toEqual(['t-k/muj.jpg']);
  expect(await page.evaluate(() => Object.keys(dokladUrl))).toEqual(['t-k/muj.jpg']);
});

test('doklad bez posunu platnosti: Objednáno zůstane a zobrazí se dotaz „Zrušit objednání?“', async ({ page }) => {
  const { store } = await mockSupabase(page, storeSDoklady());
  await page.goto('/');
  await prihlas(page, UCTY.spravce);
  await expect(page.locator('#vyrizeni')).toBeVisible();
  const nahraj = async (nazev) => {
    await page.goto('/#/o/o1/upravit');
    await page.locator('#f_soubor').setInputFiles({ name: nazev, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
    await page.getByRole('button', { name: 'Uložit' }).last().click();
    await expect(page).toHaveURL(/#\/o\/o1$/);
  };
  await nahraj('a.pdf');
  await expect(page.locator('#dotazObjednani')).toContainText('Zrušit objednání?');
  await expect(page.locator('main > .tag')).toHaveAttribute('data-stav', 'objednano');
  expect(store.opravneni.find((o) => o.id === 'o1').objednano_na).toBe('2026-11-10');
  await page.getByRole('button', { name: 'Ponechat' }).click();
  await expect(page.locator('#dotazObjednani')).toHaveCount(0);
  expect(store.opravneni.find((o) => o.id === 'o1').objednano_na).toBe('2026-11-10');
  await nahraj('b.pdf');
  await page.locator('#dotazObjednani').getByRole('button', { name: 'Zrušit objednání' }).click();
  await expect(page.locator('#dotazObjednani')).toHaveCount(0);
  await expect(page.locator('main > .tag')).toHaveAttribute('data-stav', 'predstih');
  expect(store.opravneni.find((o) => o.id === 'o1')).toMatchObject({ objednano_na: null, objednano_pozn: '' });
  expect(store.doklady.filter((d) => d.aktualni).map((d) => d.nazev)).toEqual(['b.pdf']);
});

// ---------- Etapa 4: testovací e-mail přes GitHub, výsledek z upozorneni_log ----------
test('nastavení: výsledek posledního testovacího e-mailu z logu, tlačítko Obnovit', async ({ page }) => {
  const store = vychoziStore();
  store.upozorneni_log.push(
    { id: 1, cas: '2026-11-10T05:00:00+00:00', typ: 'test', prijemce: 'stary@example.cz', polozky: [], stav: 'ok', chyba: null },
    { id: 2, cas: '2026-11-16T05:00:00+00:00', typ: 'vstup', prijemce: 'spravce@example.cz', polozky: [], stav: 'ok', chyba: null });
  await mockSupabase(page, store);
  await page.goto('/');
  await prihlas(page, UCTY.spravce);
  await expect(page.locator('#vyrizeni')).toBeVisible();
  await page.goto('/#/nastaveni');
  await expect(page.getByRole('link', { name: 'Poslat testovací e-mail' })).toHaveAttribute('href', /actions\/workflows\/upozorneni\.yml$/);
  await expect(page.locator('#posledniTest .kv[data-stav]')).toHaveText([/stary@example\.cz.*ok/]); // jen typ test
  // skript mezitím zapíše nový běh (dva příjemci, jeden s chybou) → Obnovit výsledek
  store.upozorneni_log.push(
    { id: 3, cas: '2026-11-16T09:01:00+00:00', typ: 'test', prijemce: 'spravce@example.cz', polozky: [], stav: 'ok', chyba: null },
    { id: 4, cas: '2026-11-16T09:01:00+00:00', typ: 'test', prijemce: 'karel@example.cz', polozky: [], stav: 'chyba', chyba: 'SMTPAuthenticationError: 535' });
  await page.getByRole('button', { name: 'Obnovit výsledek' }).click();
  await expect(page.locator('#posledniTest .kv[data-stav]')).toHaveCount(2);
  await expect(page.locator('#posledniTest .kv[data-stav="chyba"]')).toContainText('karel@example.cz');
  await expect(page.locator('#posledniTest')).toContainText('SMTPAuthenticationError: 535');
  await expect(page.locator('#posledniTest')).toContainText('16. 11. 2026');
  await expect(page.locator('#posledniTest')).not.toContainText('stary@example.cz');
  await bezPreteceni(page);
});

// ---------- Etapa 5: AI vyčtení přes Edge Function (napodobená) ----------
const radekAI = (page, pole) => page.locator(`#aiNavrh .ai-radek[data-pole="${pole}"]`);
test('AI vyčtení: uložený doklad i vybraná fotka, JWT správce, převzetí, uložení', async ({ page }) => {
  const store = storeSDoklady();
  store.doklady.push({ id: 'k1', opravneni_id: 'o1', technik_id: 't-k', path: 't-k/a.jpg', typ: 'image/jpeg', velikost: PNG1.length, aktualni: true, nahrano: '2026-11-01T10:00:00Z' });
  store.soubory['t-k/a.jpg'] = { body: PNG1, typ: 'image/jpeg' };
  await mockSupabase(page, store);
  await page.goto('/');
  await prihlas(page, UCTY.spravce);
  await expect(page.locator('#vyrizeni')).toBeVisible();
  await page.goto('/#/o/o1/upravit');
  await page.locator('#btnAI').click();
  await expect(page.locator('#aiNavrh .ai-radek')).toHaveCount(6); // druh bez výrobců
  expect(store.aiVolani).toHaveLength(1);
  expect(store.aiVolani[0].auth).toMatch(/^Bearer .+\..+\./);
  expect(store.aiVolani[0].apikey).toMatch(/^sb_publishable_/);
  expect(store.aiVolani[0].typ).toMatch(/^multipart\/form-data/);
  expect(store.aiVolani[0].telo).toContain('name="opravneni_id"');
  expect(store.aiVolani[0].telo).not.toContain('name="soubor"');
  await expect(page.locator('#aiZbyva')).toContainText('zbývá dnes 27');
  await expect(radekAI(page, 'technik_id')).toHaveAttribute('data-rozdil', '0'); // AI technika nenašla → nic k převzetí
  await expect(radekAI(page, 'technik_id').locator('.ai-a')).toHaveText('–');
  await expect(radekAI(page, 'cislo')).toHaveAttribute('data-rozdil', '1');
  await page.getByRole('button', { name: 'Převzít vše' }).click();
  await expect(page.locator('#f_cislo')).toHaveValue('MK-AI-2026');
  await expect(page.locator('#f_technik_id')).toHaveValue('t-k');
  // vybraná fotka má přednost a pošle se zmenšená jako JPEG
  await page.locator('#f_foto').setInputFiles(await testovaciFotka(page));
  await page.locator('#btnAI').click();
  await expect(page.locator('#aiNavrh .ai-radek')).toHaveCount(6);
  expect(store.aiVolani).toHaveLength(2);
  expect(store.aiVolani[1].telo).toContain('name="soubor"; filename="doklad.jpg"');
  expect(store.aiVolani[1].telo).toContain('Content-Type: image/jpeg');
  expect(store.aiVolani[1].telo.length).toBeLessThan(600 * 1024);
  // nic se neuloží, dokud správce neklepne Uložit
  expect(store.opravneni.find((o) => o.id === 'o1').cislo).toBe('M-o1');
  await page.getByRole('button', { name: 'Uložit' }).last().click();
  await expect(page).toHaveURL(/#\/o\/o1$/);
  expect(store.opravneni.find((o) => o.id === 'o1')).toMatchObject({ cislo: 'MK-AI-2026', vydano: '2026-10-01', platnost_do: '2028-10-01' });
});

const ZPRAVY_AI = {
  kredit: 'AI vyčtení je dočasně nedostupné: na účtu AI došel kredit nebo je vyčerpaný měsíční limit útraty. Vyplň údaje ručně.',
  denni_limit: 'Dnešní limit vyčtení AI je vyčerpaný – vyplň údaje ručně, zítra to půjde znovu.',
  limit_api: 'AI je teď přetížená požadavky – zkus to za chvíli, nebo vyplň údaje ručně.'
};
for (const [kod, status, text] of [['kredit', 402, /kredit/], ['denni_limit', 429, /limit vyčtení AI je vyčerpaný/], ['limit_api', 429, /přetížená/]]) {
  test(`AI vyčtení: chyba ${kod} = srozumitelná hláška a ruční vyplnění`, async ({ page }) => {
    const store = storeSDoklady();
    store.ai = { status, body: { chyba: kod, zprava: ZPRAVY_AI[kod], ...(kod === 'denni_limit' ? { pocet: 30, limit: 30, zbyva: 0 } : {}) } };
    await mockSupabase(page, store);
    await page.goto('/');
    await prihlas(page, UCTY.spravce);
    await expect(page.locator('#vyrizeni')).toBeVisible();
    await page.goto('/#/t/t-k/nove');
    await page.locator('#f_soubor').setInputFiles({ name: 'doklad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
    await page.locator('#btnAI').click();
    await expect(page.locator('#aiChyba')).toHaveAttribute('data-kod', kod);
    await expect(page.locator('#aiChyba')).toContainText(text);
    await expect(page.locator('#aiChyba')).toContainText('ručně');
    await expect(page.locator('#btnAI')).toBeEnabled();
    await expect(page.locator('#btnAI')).toHaveText('✨ Vyčíst AI');
    await expect(page.locator('#aiNavrh .ai-radek')).toHaveCount(0);
    // ruční vyplnění a uložení funguje dál
    await page.locator('#f_druh_id').selectOption('d-mandik');
    await page.locator('#f_cislo').fill('RUCNE-1');
    await page.getByRole('button', { name: 'Uložit' }).last().click();
    await expect(page).toHaveURL(/#\/o\//);
    expect(store.opravneni.some((o) => o.cislo === 'RUCNE-1')).toBe(true);
    chyby = chyby.filter((c) => !/Failed to load resource.*(402|429)/.test(c));
  });
}

test('AI vyčtení: technik tlačítko nevidí ani v ostrém režimu', async ({ page }) => {
  const store = storeSDoklady();
  await mockSupabase(page, store);
  await page.goto('/');
  await prihlas(page, UCTY.technik);
  await expect(page.locator('h1')).toHaveText('Karel Doklad');
  await page.goto('/#/o/o1');
  await expect(page.locator('#btnAI')).toHaveCount(0);
  await page.goto('/#/o/o1/upravit');
  await expect(page.locator('h1')).toHaveText('Nenalezeno');
  await expect(page.locator('#btnAI')).toHaveCount(0);
  expect(store.aiVolani).toHaveLength(0);
});

// ---------- Přihlášení a odhlášení, když prohlížeč blokuje localStorage ----------
// zpusob: 'tise' = volání nic neudělá, 'vyjimka' = vyhodí chybu. Platí hned i po každém obnovení stránky.
async function blokujUloziste(page, metody, zpusob = 'tise') {
  const blokuj = ({ metody, zpusob }) => metody.forEach((m) => {
    const puvodni = Storage.prototype[m];
    Storage.prototype[m] = function () {
      if (this !== window.localStorage) return puvodni.apply(this, arguments);
      if (zpusob === 'vyjimka') throw new DOMException('blokováno', 'SecurityError');
    };
  });
  await page.addInitScript(blokuj, { metody, zpusob });
  if (page.url() !== 'about:blank') await page.evaluate(blokuj, { metody, zpusob });
}
const ulozenaSession = (page) => page.evaluate(() => localStorage.getItem('opravneni-auth'));
async function prihlasenySpravce(page) {
  const mock = await mockSupabase(page);
  await page.goto('/');
  await prihlas(page, UCTY.spravce);
  await expect(page.locator('#vyrizeni')).toBeVisible();
  await expect.poll(() => ulozenaSession(page)).toContain('access_token'); // odložený zápis proběhl
  return mock;
}
async function odhlas(page) {
  await page.goto('/#/nastaveni');
  await page.getByRole('button', { name: 'Odhlásit' }).click();
  await expect(page.locator('#f_email')).toBeVisible();
}

test('mock: anon dostane 401 / 42501 jako produkce', async ({ page }) => {
  ocekavane = /Failed to load resource.*401/;
  await mockSupabase(page);
  await page.goto('/');
  await expect(page.locator('#f_email')).toBeVisible();
  const r = await page.evaluate(async () => [await db.rpc('smi'), await db.from('kategorie').select('*')].map((x) => [x.status, x.error.code, x.error.message]));
  expect(r).toEqual([[401, '42501', 'permission denied for function smi'], [401, '42501', 'permission denied for table kategorie']]);
});

for (const zpusob of ['tise', 'vyjimka']) {
  test(`blokovaný zápis localStorage (${zpusob}): po přihlášení se data načtou`, async ({ page }) => {
    const store = vychoziStore();
    store.technici.push({ id: 't-k', jmeno: 'Karel Zkušební', email: '', aktivni: true });
    await blokujUloziste(page, ['setItem'], zpusob);
    await mockSupabase(page, store);
    await page.goto('/');
    await prihlas(page, UCTY.spravce);
    await expect(page.locator('#seznam a.row[data-technik="Karel Zkušební"]')).toBeVisible();
    expect(await ulozenaSession(page)).toBeNull(); // blokování opravdu platilo
  });

  for (const metody of [['removeItem'], ['removeItem', 'setItem']]) {
    test(`blokované mazání localStorage (${metody.join(' + ')}, ${zpusob}): po odhlášení a obnovení je odhlášený`, async ({ page }) => {
      ocekavane = /Failed to load resource.*403/; // server odmítne zrušené sezení
      await prihlasenySpravce(page);
      await blokujUloziste(page, metody, zpusob);
      await odhlas(page);
      await page.reload();
      await expect(page.locator('#f_email')).toBeVisible();
      await expect(page.locator('#vyrizeni')).toHaveCount(0);
    });
  }
}

test('blokované mazání localStorage: hned po odhlášení getSession nic nevrací a jde se znovu přihlásit', async ({ page }) => {
  await prihlasenySpravce(page);
  await blokujUloziste(page, ['removeItem', 'setItem']);
  await odhlas(page);
  expect(await page.evaluate(async () => (await sb.auth.getSession()).data.session)).toBeNull();
  await prihlas(page, UCTY.spravce);
  await expect(page.locator('#vyrizeni')).toBeVisible();
});

test('blokované mazání a výpadek serveru při odhlášení: po obnovení je odhlášený', async ({ page }) => {
  ocekavane = /Failed to load resource.*500|výpadek/;
  const { store } = await prihlasenySpravce(page);
  store.selhani.logout = true;
  await blokujUloziste(page, ['removeItem']);
  await odhlas(page);
  await page.reload();
  await expect(page.locator('#f_email')).toBeVisible();
});

test('výpadek ověření sezení při startu nikoho neodhlásí', async ({ page }) => {
  ocekavane = /Failed to load resource.*503/;
  const { store } = await prihlasenySpravce(page);
  store.selhani.user = true;
  await page.reload();
  await expect(page.locator('#vyrizeni')).toBeVisible();
});

test('session se po přihlášení neuloží: česká hláška a zápis v debug panelu, žádný dotaz jako anon', async ({ page }) => {
  ocekavane = /session se neuložila/;
  const { hlavicky } = await mockSupabase(page);
  await page.goto('/?debug=1');
  await expect(page.locator('#f_email')).toBeVisible();
  await page.evaluate(() => { authStorage.setItem = () => {}; });
  await prihlas(page, UCTY.spravce);
  await expect(page.locator('#chyba')).toContainText('prohlížeč neuložil přihlášení');
  await expect(page.locator('#dbgLog')).toContainText('session se neuložila');
  await expect(page.getByRole('button', { name: 'Přihlásit' })).toBeEnabled();
  expect(hlavicky).toEqual([]);
});
