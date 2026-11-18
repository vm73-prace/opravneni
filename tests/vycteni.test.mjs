// Edge Function opravneni-vycteni (supabase/functions/opravneni-vycteni/vycteni.js) v Node:
// skutečné SDK (@anthropic-ai/sdk, @supabase/supabase-js) proti napodobenému Anthropic API a Supabase na localhostu.
// Žádné volání ven, žádný skutečný klíč.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { zpracuj, sestavNastroj, prevedNavrh, cenaUsd, kodChybyApi, zkrat, upravVydavatele, MAX_VYDAVATEL, POZN_VYDAVATEL, MODEL, SYSTEM, POVOLENE_PUVODY } from '../supabase/functions/opravneni-vycteni/vycteni.js';

const SPRAVCE = 'token-spravce', TECHNIK = 'token-technika', PUVOD = 'https://vm73-prace.github.io';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
let server, zakl, stav;

function novyStav() {
  return {
    technici: [{ id: 't1', jmeno: 'Jan Novák' }, { id: 't2', jmeno: 'Petr Svoboda' }, { id: 't3', jmeno: 'Jan Novák' }],
    druhy: [{ id: 'd-mandik', nazev: 'Mandík – požární klapky', kategorie: 'ppk', vydavatel: 'MANDÍK, a.s.', popis: 'Montáž a revize požárních klapek Mandík', lhuta_mesicu: 24, neurcita: false },
            { id: 'd-svadlenka', nazev: 'Švadlenka – PBZ', kategorie: 'ppk', vydavatel: 'Ing. Švadlenka', popis: '', lhuta_mesicu: null, neurcita: true }],
    kategorie: [{ id: 'ppk', nazev: 'PPK' }],
    vyrobci: 'Mandík, Systemair',
    doklady: [{ opravneni_id: 'o1', path: 't1/abc.pdf', aktualni: true }, { opravneni_id: 'o2', path: 't2/x.jpg', aktualni: true }],
    soubory: { 't1/abc.pdf': Buffer.from('%PDF-1.4 test'), 't2/x.jpg': JPEG },
    log: [], pocetDnes: 0, limit: 30,
    api: { rezim: 'ok' }, apiPozadavky: [], storageCesty: [], konzole: []
  };
}

const ODP_OK = (vstup) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: MODEL, stop_reason: 'tool_use',
  content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'tool_use', id: 'tu_1', name: 'navrh_opravneni', input: vstup }],
  usage: { input_tokens: 1800, output_tokens: 240, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
});
const VSTUP = {
  jmeno_na_dokladu: 'Ing. Jan Novák', technik: 'Jan Novák', druh: 'Mandík – požární klapky [PPK]', cislo: 'MK-2026-117',
  vydavatel: 'MANDÍK, a.s.', vydano: '2026-03-12', platnost_do: '2028-03-12', na_dobu_neurcitou: false,
  vyrobci: ['Mandík', 'Neznámý'], poznamka: null
};

function odpovedAnthropic(res, body) {
  stav.apiPozadavky.push(body);
  const r = stav.api.rezim;
  const err = (status, type, message, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'x-should-retry': 'false', 'request-id': 'req_t' }); res.end(JSON.stringify({ type: 'error', error: { type, message, ...extra } })); };
  if (r === 'kredit400') return err(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.');
  if (r === 'billing402') return err(402, 'billing_error', 'Billing problem');
  if (r === 'spend429') return err(429, 'rate_limit_error', 'Spend limit reached', { details: { error_code: 'enforced_spend_limit_reached' } });
  if (r === 'rate429') return err(429, 'rate_limit_error', 'Too many requests');
  if (r === 'klic401') return err(401, 'authentication_error', 'invalid x-api-key');
  if (r === 'pretizeno529') return err(529, 'overloaded_error', 'Overloaded');
  const ok = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (r === 'odmitnuto') return ok({ ...ODP_OK(VSTUP), stop_reason: 'refusal', content: [] });
  if (r === 'max') return ok({ ...ODP_OK(VSTUP), stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '', signature: 'x' }] });
  if (r === 'bezNastroje') return ok({ ...ODP_OK(VSTUP), stop_reason: 'end_turn', content: [{ type: 'text', text: 'Nevím.' }] });
  return ok(ODP_OK(stav.api.vstup || VSTUP));
}

function odpovedSupabase(req, res, url, body) {
  const kdo = (req.headers.authorization || '').replace('Bearer ', '');
  const j = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (kdo !== SPRAVCE && kdo !== TECHNIK) return j(401, { code: 'PGRST301', message: 'JWT invalid' });
  assert.equal(req.headers['accept-profile'] || req.headers['content-profile'] || (url.pathname.startsWith('/storage') ? 'opravneni' : ''), 'opravneni');
  const p = url.pathname;
  if (p === '/rest/v1/rpc/je_spravce') return j(200, kdo === SPRAVCE);
  if (kdo !== SPRAVCE) return j(403, { message: 'permission denied' });
  if (p === '/rest/v1/rpc/nastaveni_vypocet') return j(200, [{ predstih_dni: 90, vyrobci: stav.vyrobci }]);
  if (p === '/rest/v1/rpc/ai_zacni') {
    if (stav.pocetDnes >= stav.limit) return j(200, { limit_prekrocen: true, pocet: stav.pocetDnes, limit: stav.limit });
    stav.pocetDnes++; stav.log.push({ id: stav.log.length + 1, ...body, stav: 'probiha' });
    return j(200, { id: stav.log.length, pocet: stav.pocetDnes, limit: stav.limit });
  }
  if (p === '/rest/v1/rpc/ai_dokonci') { Object.assign(stav.log.find((l) => l.id === body.id), body); return j(200, null); }
  if (p === '/rest/v1/technici') return j(200, stav.technici);
  if (p === '/rest/v1/druhy') return j(200, stav.druhy);
  if (p === '/rest/v1/kategorie') return j(200, stav.kategorie);
  if (p === '/rest/v1/doklady') {
    const oid = (url.searchParams.get('opravneni_id') || '').replace('eq.', '');
    const r = stav.doklady.filter((d) => d.opravneni_id === oid && d.aktualni).map((d) => ({ path: d.path }));
    return j(200, r.length ? r[0] : null);
  }
  if (p.startsWith('/storage/v1/object/')) {
    const cesta = decodeURIComponent(p.replace(/^\/storage\/v1\/object\/(authenticated\/)?opravneni-doklady\//, ''));
    stav.storageCesty.push(cesta);
    const f = stav.soubory[cesta];
    if (!f) return j(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(f);
  }
  j(404, { message: 'neznámá cesta ' + p });
}

before(async () => {
  server = http.createServer((req, res) => {
    const kusy = [];
    req.on('data', (c) => kusy.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(kusy).toString();
      const body = raw ? JSON.parse(raw) : null;
      const url = new URL(req.url, 'http://x');
      try {
        if (url.pathname === '/v1/messages') return odpovedAnthropic(res, body);
        odpovedSupabase(req, res, url, body);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  zakl = 'http://127.0.0.1:' + server.address().port;
});
after(() => server.close());
beforeEach(() => { stav = novyStav(); });

const deps = (env = {}) => ({ env: { SUPABASE_URL: zakl, SUPABASE_ANON_KEY: 'anon', OPRAVNENI_ANTHROPIC_API_KEY: 'sk-test', ...env }, createClient, Anthropic, anthropicBaseURL: zakl });
function pozadavek({ token = SPRAVCE, soubor, typ = 'image/jpeg', opravneni_id, origin = PUVOD, metoda = 'POST' } = {}) {
  const fd = new FormData();
  if (soubor) fd.append('soubor', new Blob([soubor], { type: typ }), 'doklad');
  if (opravneni_id) fd.append('opravneni_id', opravneni_id);
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (origin) headers.origin = origin;
  return new Request(zakl + '/functions/v1/opravneni-vycteni', { method: metoda, headers, body: metoda === 'POST' ? fd : undefined });
}
async function zavolej(opt, env) {
  const puvodni = console.log;
  console.log = (...a) => stav.konzole.push(a.join(' '));
  try {
    const r = await zpracuj(pozadavek(opt), deps(env));
    const text = await r.text();
    return { status: r.status, h: r.headers, body: text ? JSON.parse(text) : null };
  } finally { console.log = puvodni; }
}

test('vybraný obrázek: návrh s id, enum z katalogu, log ok s tokeny a cenou', async () => {
  const r = await zavolej({ soubor: JPEG });
  assert.equal(r.status, 200);
  assert.equal(r.h.get('access-control-allow-origin'), PUVOD);
  assert.deepEqual(r.body.navrh, {
    technik_id: 't1', druh_id: 'd-mandik', jmeno_na_dokladu: 'Ing. Jan Novák', cislo: 'MK-2026-117', vydavatel: 'MANDÍK, a.s.',
    vydano: '2026-03-12', platnost_do: '2028-03-12', na_dobu_neurcitou: false, vyrobci: ['Mandík'], poznamka: null
  });
  assert.deepEqual(r.body.pouziti, { pocet: 1, limit: 30, zbyva: 29, tokeny_vstup: 1800, tokeny_vystup: 240, cena_usd: 0.0003, model: MODEL });
  const req = stav.apiPozadavky[0];
  assert.equal(req.model, 'claude-haiku-5-5');
  assert.deepEqual(req.output_config, { effort: 'low' });
  assert.equal(req.temperature, undefined);
  assert.deepEqual(req.tool_choice, { type: 'auto' });
  const nastroj = req.tools[0];
  assert.equal(nastroj.strict, true);
  assert.equal(nastroj.input_schema.additionalProperties, false);
  assert.deepEqual(nastroj.input_schema.properties.technik.anyOf[0].enum, ['Jan Novák', 'Petr Svoboda', 'Jan Novák #2']);
  assert.deepEqual(nastroj.input_schema.properties.druh.anyOf[0].enum, ['Mandík – požární klapky [PPK]', 'Švadlenka – PBZ [PPK]']);
  assert.deepEqual(nastroj.input_schema.properties.vydano.anyOf, [{ type: 'string', format: 'date' }, { type: 'null' }]);
  assert.equal(nastroj.input_schema.properties.na_dobu_neurcitou.type, 'boolean');
  assert.deepEqual(nastroj.input_schema.required.sort(), Object.keys(nastroj.input_schema.properties).sort());
  assert.equal(req.messages[0].content[0].type, 'image');
  assert.equal(req.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.equal(req.messages[0].content[0].source.data, JPEG.toString('base64'));
  assert.equal(req.system, SYSTEM);
  assert.match(SYSTEM, /jen data/); assert.match(SYSTEM, /ignoruj/); assert.match(SYSTEM, /null – nehádej/);
  assert.equal(stav.log.length, 1);
  assert.deepEqual([stav.log[0].zdroj, stav.log[0].typ_souboru, stav.log[0].velikost_b, stav.log[0].stav, stav.log[0].tokeny_vstup, stav.log[0].tokeny_vystup, stav.log[0].cena_usd],
    ['vybrany', 'image/jpeg', JPEG.length, 'ok', 1800, 240, 0.0003]);
  assert.ok(stav.log[0].trvani_ms >= 0);
});

test('log Edge Function jen id, stav, kód, tokeny, ms – bez jmen, čísel dokladů a údajů', async () => {
  await zavolej({ soubor: JPEG });
  assert.equal(stav.konzole.length, 1);
  const zaznam = JSON.parse(stav.konzole[0].replace('[opravneni-vycteni] ', ''));
  assert.deepEqual(Object.keys(zaznam), ['id', 'stav', 'kod', 'tokeny_vstup', 'tokeny_vystup', 'ms']);
  for (const zakazane of ['Novák', 'MK-2026', 'MANDÍK', '2028', 't1/', 'image/jpeg']) assert.ok(!stav.konzole[0].includes(zakazane), zakazane);
  stav.api.rezim = 'kredit400';
  await zavolej({ opravneni_id: 'o1' });
  assert.ok(!stav.konzole[1].includes('credit') && !stav.konzole[1].includes('abc.pdf'));
});

test('uložený doklad (PDF) se stáhne ze Storage a pošle jako document', async () => {
  const r = await zavolej({ opravneni_id: 'o1' });
  assert.equal(r.status, 200);
  assert.deepEqual(stav.storageCesty, ['t1/abc.pdf']);
  const blok = stav.apiPozadavky[0].messages[0].content[0];
  assert.equal(blok.type, 'document');
  assert.equal(blok.source.media_type, 'application/pdf');
  assert.equal(stav.log[0].zdroj, 'ulozeny');
  assert.equal(stav.log[0].typ_souboru, 'application/pdf');
});

test('na dobu neurčitou vs. platnost nenalezena; data a výrobci ověřené', async () => {
  stav.api.vstup = { ...VSTUP, platnost_do: '2030-01-01', na_dobu_neurcitou: true };
  let r = await zavolej({ soubor: JPEG });
  assert.deepEqual([r.body.navrh.platnost_do, r.body.navrh.na_dobu_neurcitou], [null, true]);
  stav.api.vstup = { ...VSTUP, platnost_do: null, na_dobu_neurcitou: false, vydano: '2026-02-30', technik: 'Někdo jiný', druh: null };
  r = await zavolej({ soubor: JPEG });
  assert.deepEqual([r.body.navrh.platnost_do, r.body.navrh.na_dobu_neurcitou, r.body.navrh.vydano, r.body.navrh.technik_id, r.body.navrh.druh_id], [null, false, null, null, null]);
});

test('denní limit: po vyčerpání 429 s hláškou, model se nevolá', async () => {
  stav.pocetDnes = 30;
  const r = await zavolej({ soubor: JPEG });
  assert.equal(r.status, 429);
  assert.equal(r.body.chyba, 'denni_limit');
  assert.match(r.body.zprava, /limit.*ručně/);
  assert.equal(r.body.zbyva, 0);
  assert.equal(stav.apiPozadavky.length, 0);
});

test('chyby API → srozumitelný kód, log chyba, nabídka ručního vyplnění', async () => {
  const pripady = [['kredit400', 402, 'kredit'], ['billing402', 402, 'kredit'], ['spend429', 402, 'kredit'], ['rate429', 429, 'limit_api'],
    ['klic401', 502, 'klic'], ['pretizeno529', 502, 'pretizeno'], ['odmitnuto', 422, 'odmitnuto'], ['max', 502, 'preruseno'], ['bezNastroje', 422, 'bez_vysledku']];
  for (const [rezim, status, kod] of pripady) {
    stav = novyStav(); stav.api.rezim = rezim;
    const r = await zavolej({ soubor: JPEG });
    assert.equal(r.status, status, rezim);
    assert.equal(r.body.chyba, kod, rezim);
    assert.match(r.body.zprava, /ručně|znovu/, rezim);
    assert.equal(stav.log[0].stav, 'chyba', rezim);
    assert.equal(stav.log[0].kod_chyby, kod, rezim);
    assert.equal(stav.apiPozadavky.length, 1, rezim + ': bez opakování');
  }
  assert.match((await (async () => { stav = novyStav(); stav.api.rezim = 'kredit400'; return zavolej({ soubor: JPEG }); })()).body.zprava, /kredit/);
});

test('síťová chyba → sit', async () => {
  const r = await zpracuj(pozadavek({ soubor: JPEG }), { ...deps(), anthropicBaseURL: 'http://127.0.0.1:1' });
  assert.equal((await r.json()).chyba, 'sit');
  assert.equal(stav.log[0].kod_chyby, 'sit');
});

test('přístup: bez přihlášení 401, technik 403, bez klíče 503 (limit se nespotřebuje)', async () => {
  assert.equal((await zavolej({ token: null, soubor: JPEG })).status, 401);
  assert.equal((await zavolej({ token: 'padelek', soubor: JPEG })).status, 401);
  const t = await zavolej({ token: TECHNIK, soubor: JPEG });
  assert.deepEqual([t.status, t.body.chyba], [403, 'jen_spravce']);
  const k = await zavolej({ soubor: JPEG }, { OPRAVNENI_ANTHROPIC_API_KEY: '' });
  assert.deepEqual([k.status, k.body.chyba], [503, 'chybi_klic']);
  assert.equal(stav.log.length, 0);
});

test('vstup: typ, velikost, chybějící doklad', async () => {
  assert.equal((await zavolej({ soubor: Buffer.from('<html>'), typ: 'text/html' })).body.chyba, 'typ_souboru');
  assert.equal((await zavolej({ soubor: Buffer.alloc(5 * 1024 * 1024 + 1), typ: 'image/png' })).body.chyba, 'velky_soubor');
  assert.equal((await zavolej({ soubor: Buffer.alloc(10 * 1024 * 1024 + 1), typ: 'application/pdf' })).body.chyba, 'velky_soubor');
  assert.equal((await zavolej({ opravneni_id: 'neni' })).body.chyba, 'bez_dokladu');
  assert.equal((await zavolej({})).body.chyba, 'spatny_pozadavek');
  assert.equal(stav.apiPozadavky.length, 0);
});

test('CORS: jen GitHub Pages organizace a localhost:8124, OPTIONS', async () => {
  assert.deepEqual(POVOLENE_PUVODY, ['https://vm73-prace.github.io', 'http://localhost:8124']);
  for (const o of POVOLENE_PUVODY) {
    const r = await zavolej({ metoda: 'OPTIONS', origin: o });
    assert.equal(r.status, 204);
    assert.equal(r.h.get('access-control-allow-origin'), o);
    assert.match(r.h.get('access-control-allow-headers'), /authorization/);
    assert.match(r.h.get('access-control-allow-methods'), /POST/);
  }
  const cizi = await zavolej({ metoda: 'OPTIONS', origin: 'https://zly.example' });
  assert.equal(cizi.status, 403);
  assert.equal(cizi.h.get('access-control-allow-origin'), null);
  const post = await zavolej({ soubor: JPEG, origin: 'https://vm73.github.io' });
  assert.equal(post.status, 403);
  assert.equal(stav.apiPozadavky.length, 0);
  assert.equal((await zavolej({ soubor: JPEG, origin: null })).status, 200); // mimo prohlížeč (PowerShell)
});

test('poznámka: krátká beze změny, dlouhá uříznutá na konci slova s „…“, schéma žádá do 200 znaků', async () => {
  const kratka = 'Datum vydání je částečně rozmazané.';
  stav.api.vstup = { ...VSTUP, poznamka: kratka };
  assert.equal((await zavolej({ soubor: JPEG })).body.navrh.poznamka, kratka);
  const slova = 'Dokument obsahuje zkušební řád a prázdné vzory certifikátů bez vyplněných údajů držitele, ';
  const dlouha = slova.repeat(12); // ~1 100 znaků
  stav = novyStav(); stav.api.vstup = { ...VSTUP, poznamka: dlouha };
  const p = (await zavolej({ soubor: JPEG })).body.navrh.poznamka;
  assert.ok(p.length <= 500, 'délka ' + p.length);
  assert.ok(p.length > 400, 'zbytečně krátká ' + p.length);
  assert.ok(p.endsWith('…'));
  const bezTecek = p.slice(0, -1);
  assert.ok(dlouha.startsWith(bezTecek), 'začátek textu zachovaný');
  assert.match(dlouha.slice(bezTecek.length), /^[\s,]/, 'uříznuto na konci celého slova: „' + bezTecek.slice(-15) + '“');
  assert.match(stav.apiPozadavky[0].tools[0].input_schema.properties.poznamka.description, /1–2 krátké věty, do 200 znaků/);
  assert.equal(zkrat('a'.repeat(600), 500).length, 500); // jedno dlouhé „slovo“ → tvrdý řez + …
  assert.equal(zkrat('  ', 500), null);
});

test('seznam druhů obsahuje popis a výchozí lhůtu; SYSTEM žádá výběr podle významu', async () => {
  stav.druhy.push({ id: 'd-bez', nazev: 'Bez popisu', kategorie: 'ppk', vydavatel: '' });
  const r = await zavolej({ soubor: JPEG });
  assert.equal(r.status, 200);
  const poz = stav.apiPozadavky[0];
  const text = poz.messages[0].content[1].text;
  assert.match(text, /- Mandík – požární klapky \[PPK\] \(MANDÍK, a\.s\.\) – Montáž a revize požárních klapek Mandík; výchozí platnost: 24 měsíců/);
  assert.match(text, /- Švadlenka – PBZ \[PPK\] \(Ing\. Švadlenka\) – výchozí platnost: doba neurčitá/);
  assert.match(text, /- Bez popisu \[PPK\]\n/, 'druh bez popisu a lhůty bez přípony');
  assert.deepEqual(poz.tools[0].input_schema.properties.druh.anyOf[0].enum, ['Mandík – požární klapky [PPK]', 'Švadlenka – PBZ [PPK]', 'Bez popisu [PPK]'], 'enum beze změny (jen název + kategorie)');
  assert.match(poz.system, /Druh vyber podle významu \(paragraf, popis, vydavatel, délka platnosti\)/);
  assert.match(poz.system, /v poznámce uveď kandidáty/);
});

test('vydavatel (v5): popis pole „Jen obchodní název“, dlouhá věta oříznutá za právní formou + poznámka, krátký beze změny', async () => {
  // dlouhá věta se Systemair → jen název firmy, do poznámky upozornění
  const veta = 'Systemair Production a.s. společně s výhradním dodavatelem pro Českou republiku, Hlavní 1, 100 00 Praha 10';
  assert.ok(veta.length > MAX_VYDAVATEL);
  stav.api.vstup = { ...VSTUP, vydavatel: veta };
  let r = await zavolej({ soubor: JPEG });
  assert.equal(r.status, 200);
  assert.equal(r.body.navrh.vydavatel, 'Systemair Production a.s.');
  assert.equal(r.body.navrh.poznamka, POZN_VYDAVATEL);
  assert.equal(POZN_VYDAVATEL, 'vydavatel zkrácen – zkontroluj');
  const popis = stav.apiPozadavky[0].tools[0].input_schema.properties.vydavatel;
  assert.match(popis.description, /Jen obchodní název/);
  assert.match(popis.description, /bez dalšího textu, adresy a vztahů k jiným firmám/);
  assert.deepEqual(popis.anyOf, [{ type: 'string' }, { type: 'null' }], 'typ pole beze změny');

  // existující poznámka zůstane, upozornění se připojí (celkem do 500 znaků)
  stav = novyStav(); stav.api.vstup = { ...VSTUP, vydavatel: veta, poznamka: 'Datum vydání je rozmazané.' };
  r = await zavolej({ soubor: JPEG });
  assert.equal(r.body.navrh.poznamka, 'Datum vydání je rozmazané; ' + POZN_VYDAVATEL);
  stav = novyStav(); stav.api.vstup = { ...VSTUP, vydavatel: veta, poznamka: 'slovo '.repeat(200) };
  r = await zavolej({ soubor: JPEG });
  assert.ok(r.body.navrh.poznamka.length <= 500 && r.body.navrh.poznamka.endsWith('…; ' + POZN_VYDAVATEL));

  // krátký vydavatel beze změny, bez poznámky
  for (const kratky of ['MANDÍK, a.s.', 'Systemair a.s.', 'Ing. Švadlenka']) {
    stav = novyStav(); stav.api.vstup = { ...VSTUP, vydavatel: kratky };
    r = await zavolej({ soubor: JPEG });
    assert.deepEqual([r.body.navrh.vydavatel, r.body.navrh.poznamka], [kratky, null], kratky);
  }

  // další právní formy; „se“ jako běžné slovo není SE; bez právní formy zůstane (do 150 znaků) bez poznámky
  const dodatek = ' ve spolupráci s autorizovaným školicím střediskem pro Českou a Slovenskou republiku';
  assert.deepEqual(upravVydavatele('ATREA s.r.o.' + dodatek), { vydavatel: 'ATREA s.r.o.', zkracen: true });
  assert.deepEqual(upravVydavatele('Firma Příklad spol. s r. o.' + dodatek), { vydavatel: 'Firma Příklad spol. s r. o.', zkracen: true });
  assert.deepEqual(upravVydavatele('Beispiel Lüftung GmbH, Musterstraße 5, 12345 Musterstadt, Deutschland – Schulungszentrum'), { vydavatel: 'Beispiel Lüftung GmbH', zkracen: true });
  const bezFormy = 'Zkušební komise se sídlem v Praze ve spolupráci s autorizovaným školicím střediskem pro ČR';
  assert.ok(bezFormy.length > MAX_VYDAVATEL && bezFormy.length <= 150);
  assert.deepEqual(upravVydavatele(bezFormy), { vydavatel: bezFormy, zkracen: false });
  const preDlouhy = upravVydavatele('slovo '.repeat(40));
  assert.ok(preDlouhy.zkracen && preDlouhy.vydavatel.length <= 150 && preDlouhy.vydavatel.endsWith('…'));
  assert.deepEqual(upravVydavatele(null), { vydavatel: null, zkracen: false });
  assert.deepEqual(upravVydavatele('   '), { vydavatel: null, zkracen: false });
});

test('cena a pomocné funkce', () => {
  assert.equal(cenaUsd(2000, 300), 0.00035);
  assert.equal(cenaUsd(200000, 1000), 0.1025); // nad 100 tis. vstupních tokenů vyšší sazba
  const s = sestavNastroj({ technici: [], druhy: [], kategorie: [], vyrobci: [] });
  assert.deepEqual(s.nastroj.input_schema.properties.technik.type, 'null');
  assert.deepEqual(prevedNavrh({ vyrobci: 'x', cislo: '  ', vydano: '12.3.2026' }, s, []).vyrobci, []);
  assert.equal(kodChybyApi(new Error('x'), Anthropic), 'neznama');
});
