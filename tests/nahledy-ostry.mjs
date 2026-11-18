// Screenshoty ostrého režimu (iPhone 13) proti napodobenému Supabase do nahledy/: node tests/nahledy-ostry.mjs
// (běžící server na 8124: npm run serve -- 8124). Ostrá data se nepoužívají.
import { chromium, devices } from '@playwright/test';
import { mockSupabase, vychoziStore, UCTY, HESLO } from './supabase-mock.mjs';

const osvedceni = (text) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="840" viewBox="0 0 600 420">
  <rect width="600" height="420" fill="#f7f3e8"/><rect x="18" y="18" width="564" height="384" fill="none" stroke="#2c5f94" stroke-width="6"/>
  <text x="300" y="120" text-anchor="middle" font-family="Georgia,serif" font-size="44" fill="#2c5f94">OSVĚDČENÍ</text>
  <text x="300" y="190" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#333">${text}</text>
  <circle cx="480" cy="320" r="46" fill="none" stroke="#b33" stroke-width="5"/><path d="M90 330h200" stroke="#333" stroke-width="2"/></svg>`);
const z = (id, t, druh, platnost, extra = {}) => ({ id, technik_id: t, druh_id: druh, cislo: 'C-' + id, vydavatel: '', vydano: '2024-11-01', platnost_do: platnost,
  neurcita: false, vyrobci: [], predstih_dni: null, objednano_na: null, objednano_pozn: '', poznamka: '', bez_dokladu: false, ...extra });

function data() {
  const s = vychoziStore();
  s.technici.push({ id: 't1', jmeno: 'Karel Novotný', email: 'karel@example.cz', aktivni: true }, { id: 't2', jmeno: 'Pavel Horák', email: '', aktivni: true });
  s.uzivatele.push({ user_id: UCTY.technik.id, role: 'technik', technik_id: 't1' });
  s.opravneni.push(z('o1', 't1', 'd-mandik', '2026-12-20'), z('o2', 't1', 'd-par6', '2029-05-01'),
    z('o3', 't2', 'd-daikin', '2026-11-01', { objednano_na: '2026-12-08', objednano_pozn: 'Daikin Praha' }), z('o4', 't2', 'd-fplyny', null, { neurcita: true }));
  const d = (id, o, t, soubor, typ, aktualni, nahrano) => ({ id, opravneni_id: o, technik_id: t, path: `${t}/${soubor}`, typ, nazev: typ === 'application/pdf' ? 'osvedceni.pdf' : 'foto-dokladu.jpg', velikost: 310000, aktualni, nahrano });
  s.doklady.push(d('k1', 'o1', 't1', 'a.svg', 'image/jpeg', true, '2026-11-16T09:00:00Z'), d('k0', 'o1', 't1', 'stary.svg', 'image/jpeg', false, '2024-11-03T09:00:00Z'),
    d('k2', 'o2', 't1', 'b.pdf', 'application/pdf', true, '2025-05-02T09:00:00Z'), d('k3', 'o4', 't2', 'c.svg', 'image/jpeg', true, '2025-01-10T09:00:00Z'));
  s.soubory['t1/a.svg'] = { body: osvedceni('Mandík – Karel Novotný'), typ: 'image/svg+xml' };
  s.soubory['t1/stary.svg'] = { body: osvedceni('Mandík 2022 – Karel Novotný'), typ: 'image/svg+xml' };
  s.soubory['t1/b.pdf'] = { body: Buffer.from('%PDF-1.4\n%%EOF'), typ: 'application/pdf' };
  s.soubory['t2/c.svg'] = { body: osvedceni('F-plyny – Pavel Horák'), typ: 'image/svg+xml' };
  return s;
}

const b = await chromium.launch({ channel: 'chrome' });
async function snimky(ucet, kroky) {
  const ctx = await b.newContext({ ...devices['iPhone 13'], locale: 'cs-CZ', timezoneId: 'Europe/Prague' });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date('2026-11-16T10:00:00+01:00'));
  await mockSupabase(p, data());
  await p.goto('http://localhost:8124/');
  if (ucet) {
    await p.locator('#f_email').fill(ucet.email); await p.locator('#f_heslo').fill(HESLO);
    await p.getByRole('button', { name: 'Přihlásit' }).click();
    await p.locator('#seznam, #stav-technika').first().waitFor();
  }
  for (const [nazev, akce] of kroky) {
    if (akce) await akce(p);
    await p.waitForTimeout(400);
    await p.screenshot({ path: `nahledy/${nazev}.png`, fullPage: true });
  }
  await ctx.close();
}
await snimky(null, [['e3-1-prihlaseni']]);
await snimky(UCTY.spravce, [
  ['e3-2-prehled-spravce'],
  ['e3-3-zaznam-s-dokladem', (p) => p.goto('http://localhost:8124/#/o/o1')],
  ['e3-4-formular-doklad', async (p) => {
    await p.goto('http://localhost:8124/#/o/o1/upravit#doklad');
    await p.locator('#f_soubor').setInputFiles({ name: 'osvedceni-2026.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  }]
]);
await snimky(UCTY.technik, [['e3-5-technik']]);
await b.close();
console.log('ok');
