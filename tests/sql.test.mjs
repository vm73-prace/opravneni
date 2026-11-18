// Ověření migrace sql/001_init.sql (a 001_rollback.sql) na lokálním Postgresu (PGlite, běží v Node bez instalace).
// Supabase části (role, auth, storage, extensions, public.profily) jsou stuby podle průzkumu sql/000_pruzkum.sql (2026-11-16).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const V = '11111111-1111-1111-1111-111111111111'; // správce (v testu smyšlené UUID): appka_a, appka_b, appka_c, appka_d → + opravneni
const T = '22222222-2222-2222-2222-222222222222'; // technik s účtem a appkou opravneni
const U = '55555555-5555-5555-5555-555555555555'; // druhý technik s účtem
const X = '33333333-3333-3333-3333-333333333333'; // účet jen s jinou appkou
const D = '44444444-4444-4444-4444-444444444444'; // neaktivní účet s opravneni
const STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions; create extension pgcrypto schema extensions;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text);
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  alter table storage.objects enable row level security;
  create function storage.protect_delete() returns trigger language plpgsql as $$ begin
    if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
      raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.' using errcode = '42501';
    end if; return null; end $$;
  create trigger protect_buckets_delete before delete on storage.buckets for each statement execute function storage.protect_delete();
  create trigger protect_objects_delete before delete on storage.objects for each statement execute function storage.protect_delete();
  -- buckety a politika jiných appek (musí zůstat beze změny)
  insert into storage.buckets (id, name, public) values ('appka-a-fotky', 'appka-a-fotky', false), ('appka-d-protokoly', 'appka-d-protokoly', false);
  create policy "appka_a - nahrani souboru" on storage.objects for insert to authenticated with check (bucket_id = 'appka-a-fotky');
  create policy "appka_d - cteni souboru" on storage.objects for select to authenticated using (bucket_id = 'appka-d-protokoly');
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.profily (
    id uuid primary key references auth.users on delete cascade, email text, role text not null default 'technik',
    aktivni boolean not null default false, token_hash text, vytvoreno timestamptz not null default now(),
    aplikace text[] not null default '{}');
  alter table public.profily enable row level security;
  create policy "profily - cteni" on public.profily for select to authenticated using (id = (select auth.uid()));
  grant usage on schema auth, storage, public, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to authenticated, service_role;
  grant select on storage.buckets to authenticated;
  insert into auth.users values ('${V}'), ('${T}'), ('${U}'), ('${X}'), ('${D}');
  insert into public.profily (id, role, aktivni, aplikace) values
    ('${V}', 'admin', true, '{appka_a,appka_b,appka_c,appka_d}'), ('${T}', 'technik', true, '{opravneni}'),
    ('${U}', 'technik', true, '{appka_a,opravneni}'), ('${X}', 'technik', true, '{appka_a}'), ('${D}', 'technik', false, '{opravneni}');
`;
const INIT = readFileSync(new URL('../sql/001_init.sql', import.meta.url), 'utf8');
const ROLLBACK = readFileSync(new URL('../sql/001_rollback.sql', import.meta.url), 'utf8');
const UPOZORNENI = readFileSync(new URL('../sql/002_upozorneni.sql', import.meta.url), 'utf8');
const UPOZORNENI_ROLLBACK = readFileSync(new URL('../sql/002_rollback.sql', import.meta.url), 'utf8');
const AI_LOG = readFileSync(new URL('../sql/003_ai_log.sql', import.meta.url), 'utf8');
// Přístup účtů je mimo git (sql/lokalni/). Když soubor je, testuje se jeho skutečný obsah se smyšleným UUID místo
// skutečného; na PC bez něj stejný vzor napsaný tady.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
function lokalni(soubor, nahrada) {
  const u = new URL('../sql/lokalni/' + soubor, import.meta.url);
  return existsSync(u) ? readFileSync(u, 'utf8').replace(UUID, V) : nahrada;
}
const PRISTUP = lokalni('001b_pristup.sql', `begin;
  update public.profily set aplikace = array_append(aplikace, 'opravneni') where id = '${V}' and not ('opravneni' = any(aplikace));
  insert into opravneni.uzivatele (user_id, role) values ('${V}', 'spravce') on conflict (user_id) do update set role = 'spravce', technik_id = null;
  commit;`);
const PRISTUP_ROLLBACK = lokalni('001b_rollback.sql', `begin; update public.profily set aplikace = array_remove(aplikace, 'opravneni') where id = '${V}'; commit;`);
// Výpočet stavů z appky (calc.js) – technik musí mít z DB vše, co k němu potřebuje
const src = readFileSync(new URL('../calc.js', import.meta.url), 'utf8');
const Calc = vm.runInNewContext(src.slice(src.indexOf('// <calc>'), src.indexOf('// </calc>')) + ';Calc', { Intl, Date, Math, String, Number });

let db;
async function jako(kdo, sql, params) {
  const role = kdo === 'anon' ? 'anon' : 'authenticated';
  const sub = kdo === 'anon' ? '' : kdo;
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub}', false); set role ${role};`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role;'); }
}
const chyba = (p, re) => assert.rejects(p, re);
const pocet = async (kdo, t) => (await jako(kdo, `select count(*)::int c from ${t}`)).rows[0].c;

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  await db.exec(INIT);
  await db.exec(PRISTUP);
  await db.exec(UPOZORNENI);
  await db.exec(AI_LOG);
});

test('správce dostal opravneni a roli správce, ostatní profily beze změny; katalog je naplněný', async () => {
  const r = (await db.query(`select id, aplikace from public.profily order by id`)).rows;
  assert.deepEqual(Object.fromEntries(r.map((x) => [x.id, x.aplikace])), {
    [V]: ['appka_a', 'appka_b', 'appka_c', 'appka_d', 'opravneni'], [T]: ['opravneni'], [U]: ['appka_a', 'opravneni'], [X]: ['appka_a'], [D]: ['opravneni']
  });
  assert.equal((await db.query(`select obj_description('opravneni'::regnamespace) k`)).rows[0].k, 'Evidence oprávnění techniků – vm73-prace/opravneni');
  assert.equal(await pocet(V, 'opravneni.kategorie'), 4);
  assert.equal(await pocet(V, 'opravneni.druhy'), 13);
  assert.equal((await jako(V, `select predstih_dni from opravneni.nastaveni`)).rows[0].predstih_dni, 90);
  assert.equal((await jako(V, `select opravneni.je_spravce() s`)).rows[0].s, true);
  // 001b jde spustit znovu bez chyby a bez zdvojení
  await db.exec(PRISTUP);
  assert.deepEqual((await db.query(`select aplikace from public.profily where id = '${V}'`)).rows[0].aplikace, ['appka_a', 'appka_b', 'appka_c', 'appka_d', 'opravneni']);
  // bez 001b nemá nikdo přístup – migrace sama žádný účet nepovolí
  assert.equal((await db.query(`select count(*)::int c from opravneni.uzivatele`)).rows[0].c, 1);
});

let t1, t2, o1, o2;
test('správce: technici, oprávnění, doklady, propojení účtů', async () => {
  t1 = (await jako(V, `insert into opravneni.technici (jmeno, email) values ('Technik Jedna', 't1@example.cz') returning id`)).rows[0].id;
  t2 = (await jako(V, `insert into opravneni.technici (jmeno) values ('Technik Dva') returning id`)).rows[0].id;
  const druh = (await jako(V, `select id from opravneni.druhy where nazev = 'Mandík – požární klapky'`)).rows[0].id;
  const neur = (await jako(V, `select id from opravneni.druhy where neurcita`)).rows[0].id;
  o1 = (await jako(V, `insert into opravneni.opravneni (technik_id, druh_id, cislo, vydano, platnost_do) values ($1, $2, 'A1', '2025-01-01', '2027-01-01') returning *`, [t1, druh])).rows[0];
  assert.deepEqual(o1.vyrobci, []); assert.equal(o1.objednano_na, null);
  o2 = (await jako(V, `insert into opravneni.opravneni (technik_id, druh_id, neurcita) values ($1, $2, true) returning *`, [t2, neur])).rows[0];
  await jako(V, `insert into opravneni.doklady (opravneni_id, technik_id, path, typ, aktualni) values ($1, $2, $3, 'image/jpeg', false)`, [o1.id, t1, `${t1}/stary.jpg`]);
  await jako(V, `insert into opravneni.doklady (opravneni_id, technik_id, path, typ) values ($1, $2, $3, 'application/pdf')`, [o1.id, t1, `${t1}/novy.pdf`]);
  await jako(V, `insert into opravneni.doklady (opravneni_id, technik_id, path) values ($1, $2, $3)`, [o2.id, t2, `${t2}/f.jpg`]);
  await jako(V, `insert into opravneni.uzivatele (user_id, role, technik_id) values ($1, 'technik', $2), ($3, 'technik', $4)`, [T, t1, U, t2]);
  // updated_at se mění při úpravě
  const pred = o1.updated_at;
  await new Promise((r) => setTimeout(r, 5));
  const po = (await jako(V, `update opravneni.opravneni set objednano_na = '2026-12-01' where id = $1 returning updated_at`, [o1.id])).rows[0].updated_at;
  assert.ok(po > pred);
  await jako(V, `insert into storage.objects (bucket_id, name) values ('opravneni-doklady', $1), ('opravneni-doklady', $2)`, [`${t1}/novy.pdf`, `${t2}/f.jpg`]);
});

test('technik vidí jen svou sekci a katalog', async () => {
  assert.equal(await pocet(T, 'opravneni.technici'), 1);
  assert.equal((await jako(T, `select id from opravneni.technici`)).rows[0].id, t1);
  assert.equal(await pocet(T, 'opravneni.opravneni'), 1);
  assert.equal(await pocet(T, 'opravneni.doklady'), 2); // aktuální i historie
  assert.equal(await pocet(T, 'opravneni.kategorie'), 4);
  assert.equal(await pocet(T, 'opravneni.druhy'), 13);
  assert.equal(await pocet(T, 'opravneni.uzivatele'), 1); // jen svůj řádek
  assert.equal(await pocet(T, 'opravneni.nastaveni'), 0);
  assert.equal(await pocet(T, 'opravneni.upozorneni_log'), 0);
  assert.equal((await jako(T, `select opravneni.je_spravce() s, opravneni.muj_technik() m`)).rows[0].m, t1);
  // soubory: jen svoje složka
  assert.deepEqual((await jako(T, `select name from storage.objects where bucket_id = 'opravneni-doklady'`)).rows.map((r) => r.name), [`${t1}/novy.pdf`]);
  assert.deepEqual((await jako(U, `select name from storage.objects where bucket_id = 'opravneni-doklady'`)).rows.map((r) => r.name), [`${t2}/f.jpg`]);
});

test('technik spočítá stav s globálním předstihem z nastavení', async () => {
  const druh = (await jako(V, `select id from opravneni.druhy where nazev = 'Atrea – VZT jednotky'`)).rows[0].id; // druh bez vlastního předstihu
  const o = (await jako(V, `insert into opravneni.opravneni (technik_id, druh_id, platnost_do) values ($1, $2, '2027-06-01') returning id`, [t1, druh])).rows[0];
  const stav = async () => {
    const z = (await jako(T, `select * from opravneni.opravneni where id = $1`, [o.id])).rows[0];
    const d = (await jako(T, `select * from opravneni.druhy where id = $1`, [z.druh_id])).rows[0];
    const n = (await jako(T, `select * from opravneni.nastaveni_vypocet()`)).rows[0];
    const iso = (x) => x && new Date(x).toISOString().slice(0, 10);
    return Calc.stavOpravneni({ ...z, platnost_do: iso(z.platnost_do) }, d, '2026-11-16', n);
  };
  let s = await stav(); // 197 dní, globální předstih 90 → platné
  assert.equal(s.predstih, 90); assert.equal(s.stav, 'platne');
  await jako(V, `update opravneni.nastaveni set predstih_dni = 200`);
  s = await stav(); // globální předstih 200 → v předstihu
  assert.equal(s.predstih, 200); assert.equal(s.stav, 'predstih');
  assert.deepEqual(Object.keys((await jako(T, `select * from opravneni.nastaveni_vypocet()`)).rows[0]).sort(), ['predstih_dni', 'vyrobci']);
  // bez přístupu k appce funkce nevrátí nic
  assert.equal((await jako(X, `select * from opravneni.nastaveni_vypocet()`)).rows.length, 0);
  await jako(V, `update opravneni.nastaveni set predstih_dni = 90`);
  await jako(V, `delete from opravneni.opravneni where id = $1`, [o.id]);
});

test('technik nevidí tajne ani příjemce souhrnu; tajne nečte ani správce', async () => {
  await jako(V, `update opravneni.nastaveni set prijemci = 'spravce@example.cz'`);
  assert.equal(await pocet(T, 'opravneni.nastaveni'), 0);
  await chyba(jako(T, `select * from opravneni.tajne`), /permission denied/);
  await chyba(jako(V, `select * from opravneni.tajne`), /permission denied/);
  await chyba(jako(V, `update opravneni.tajne set token_hash = null`), /permission denied/);
  await chyba(jako('anon', `select * from opravneni.tajne`), /permission denied/);
  assert.equal((await jako(V, `select prijemci from opravneni.nastaveni`)).rows[0].prijemci, 'spravce@example.cz');
  assert.ok(!JSON.stringify((await jako(T, `select * from opravneni.nastaveni_vypocet()`)).rows).includes('spravce@'));
  // token_hash jen hex SHA-256
  await chyba(db.query(`update opravneni.tajne set token_hash = 'tajne'`), /check/);
  await db.query(`update opravneni.tajne set token_hash = $1`, ['a'.repeat(64)]);
  await db.query(`update opravneni.tajne set token_hash = null`);
});

test('technik nic nezmění', async () => {
  assert.equal((await jako(T, `update opravneni.opravneni set cislo = 'X'`)).affectedRows, 0);
  assert.equal((await jako(T, `delete from opravneni.doklady`)).affectedRows, 0);
  assert.equal((await jako(T, `update opravneni.druhy set nazev = 'X'`)).affectedRows, 0);
  await chyba(jako(T, `insert into opravneni.opravneni (technik_id, druh_id, neurcita) values ($1, $2, true)`, [t1, o2.druh_id]), /row-level security/);
  await chyba(jako(T, `insert into opravneni.uzivatele (user_id, role) values ($1, 'spravce')`, [T]), /row-level security/);
  await chyba(jako(T, `update opravneni.uzivatele set role = 'spravce'`).then((r) => { if (r.affectedRows === 0) throw new Error('row-level security'); }), /row-level security/);
  await chyba(jako(T, `insert into storage.objects (bucket_id, name) values ('opravneni-doklady', $1)`, [`${t1}/podvrh.pdf`]), /row-level security/);
  await chyba(jako(T, `insert into opravneni.upozorneni_log (typ, prijemce) values ('test', 'x')`), /permission denied/);
});

test('bez opravneni v profilu, neaktivní účet nebo odebraná appka = nic', async () => {
  for (const kdo of [X, D]) {
    for (const t of ['kategorie', 'druhy', 'technici', 'opravneni', 'doklady', 'uzivatele']) assert.equal(await pocet(kdo, 'opravneni.' + t), 0, t);
    await chyba(jako(kdo, `insert into opravneni.kategorie (id, nazev) values ('xx', 'x')`), /row-level security/);
  }
  await db.exec(`update public.profily set aktivni = false where id = '${T}'`);
  assert.equal(await pocet(T, 'opravneni.opravneni'), 0);
  assert.equal(await pocet(T, 'opravneni.kategorie'), 0);
  await db.exec(`update public.profily set aktivni = true where id = '${T}'`);
  // správce bez appky v profilu přestane být správcem
  await db.exec(`update public.profily set aplikace = array_remove(aplikace, 'opravneni') where id = '${V}'`);
  assert.equal(await pocet(V, 'opravneni.technici'), 0);
  await db.exec(`update public.profily set aplikace = array_append(aplikace, 'opravneni') where id = '${V}'`);
});

test('anonym nemá přístup k tabulkám, funkcím ani souborům', async () => {
  await chyba(jako('anon', `select * from opravneni.opravneni`), /permission denied/);
  await chyba(jako('anon', `select * from opravneni.kategorie`), /permission denied/);
  await chyba(jako('anon', `select opravneni.smi()`), /permission denied/);
  await chyba(jako('anon', `select opravneni.je_spravce()`), /permission denied/);
  await chyba(jako('anon', `select opravneni.over_token('x')`), /permission denied/);
  // anon smí jen dvě funkce skriptu upozornění (chráněné tokenem), PUBLIC nic
  const f = (await db.query(`select p.proname from pg_proc p where p.pronamespace = 'opravneni'::regnamespace
    and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee in (0, 'anon'::regrole))) order by 1`)).rows.map((r) => r.proname);
  assert.deepEqual(f, ['upozorneni_data', 'zapis_upozorneni']);
});

// ---------- 002: data a log pro skript upozornění ----------
const TOKEN = 'testovaci-token-' + 'x'.repeat(40);
const sha = (t) => createHash('sha256').update(t).digest('hex');

test('002: bez nastaveného tokenu i se špatným tokenem funkce odmítnou', async () => {
  await chyba(jako('anon', `select opravneni.upozorneni_data($1)`, [TOKEN]), /neplatný token/); // token_hash je null
  await db.query(`update opravneni.tajne set token_hash = $1`, [sha(TOKEN)]);
  await chyba(jako('anon', `select opravneni.upozorneni_data('spatny')`), /neplatný token/);
  await chyba(jako('anon', `select opravneni.upozorneni_data('')`), /neplatný token/);
  await chyba(jako('anon', `select opravneni.upozorneni_data(null)`), /neplatný token/);
  await chyba(jako('anon', `select opravneni.zapis_upozorneni('spatny', '[]')`), /neplatný token/);
  // přihlášený uživatel (ani správce) je volat nesmí – jen skript s publishable klíčem
  await chyba(jako(V, `select opravneni.upozorneni_data($1)`, [TOKEN]), /permission denied/);
  await chyba(jako(T, `select opravneni.zapis_upozorneni($1, '[]')`, [TOKEN]), /permission denied/);
});

test('002: upozorneni_data vrátí jen potřebná pole, zapis_upozorneni zapíše log', async () => {
  await db.query(`update opravneni.tajne set token_hash = $1`, [sha(TOKEN)]);
  await jako(V, `update opravneni.nastaveni set prijemci = 'spravce@example.cz'`);
  await jako(V, `update opravneni.opravneni set poznamka = 'interní poznámka' where id = $1`, [o1.id]);
  const d = (await jako('anon', `select opravneni.upozorneni_data($1) d`, [TOKEN])).rows[0].d;
  assert.deepEqual(Object.keys(d).sort(), ['druhy', 'kategorie', 'log', 'nastaveni', 'opravneni', 'technici']);
  assert.deepEqual(d.nastaveni, { predstih_dni: 90, prijemci: 'spravce@example.cz' });
  assert.ok(d.technici.some((t) => t.id === t1 && t.email === 't1@example.cz'));
  const o = d.opravneni.find((x) => x.id === o1.id);
  assert.deepEqual(Object.keys(o).sort(), ['cislo', 'druh_id', 'id', 'neurcita', 'objednano_na', 'platnost_do', 'predstih_dni', 'technik_id', 'updated_at']);
  assert.ok(!JSON.stringify(d).includes('interní poznámka')); // poznámky ani doklady skript nedostane
  assert.ok(!JSON.stringify(d).includes('token_hash'));
  assert.deepEqual(d.kategorie.map((k) => k.id), ['ppk', 'vyrobci', 'fplyny', 'elektro']);
  assert.deepEqual(d.log, []);

  const n = (await jako('anon', `select opravneni.zapis_upozorneni($1, $2) n`, [TOKEN, JSON.stringify([
    { typ: 'vstup', prijemce: 'spravce@example.cz', polozky: [o1.id] },
    { typ: 'test', prijemce: 't1@example.cz', polozky: [], stav: 'chyba', chyba: 'SMTP 535' }
  ])])).rows[0].n;
  assert.equal(n, 2);
  const log = (await jako(V, `select typ, prijemce, polozky, stav, chyba from opravneni.upozorneni_log order by id`)).rows;
  assert.deepEqual(log.map((r) => [r.typ, r.prijemce, r.polozky, r.stav, r.chyba]), [
    ['vstup', 'spravce@example.cz', [o1.id], 'ok', null], ['test', 't1@example.cz', [], 'chyba', 'SMTP 535']]);
  const d2 = (await jako('anon', `select opravneni.upozorneni_data($1) d`, [TOKEN])).rows[0].d;
  assert.equal(d2.log.length, 2);
  assert.deepEqual(d2.log[0].polozky, [o1.id]);
  // technik log nevidí, anon tabulku přímo nečte
  assert.equal(await pocet(T, 'opravneni.upozorneni_log'), 0);
  await chyba(jako('anon', `select * from opravneni.upozorneni_log`), /permission denied/);
});

test('002: zapis_upozorneni hlídá vstup', async () => {
  await db.query(`update opravneni.tajne set token_hash = $1`, [sha(TOKEN)]);
  const zapis = (z) => jako('anon', `select opravneni.zapis_upozorneni($1, $2)`, [TOKEN, JSON.stringify(z)]);
  await chyba(zapis({ typ: 'test' }), /pole/);
  await chyba(zapis(Array.from({ length: 201 }, () => ({ typ: 'test', prijemce: 'x' }))), /200/);
  await chyba(zapis([{ typ: 'spam', prijemce: 'x' }]), /check/);
  await chyba(zapis([{ typ: 'test', prijemce: 'x', stav: 'jiny' }]), /check/);
  await chyba(zapis([{ typ: 'test', prijemce: 'x', polozky: ['neni-uuid'] }]), /uuid/);
  await chyba(zapis([{ typ: 'test' }]), /null value/); // bez příjemce
  assert.equal((await jako('anon', `select opravneni.zapis_upozorneni($1, '[]') n`, [TOKEN])).rows[0].n, 0);
});

test('003: ai_zacni jen správce, limit 30 za den, ai_dokonci jen vlastní řádek', async () => {
  const zacni = (kdo) => jako(kdo, `select opravneni.ai_zacni('vybrany', 'image/jpeg', 300000, 'claude-haiku-5-5') r`).then((x) => x.rows[0].r);
  await chyba(zacni(T), /jen správce/);
  await chyba(zacni('anon'), /permission denied/);
  await chyba(jako('anon', `select * from opravneni.ai_log`), /permission denied/);
  await chyba(jako(V, `insert into opravneni.ai_log (zdroj, typ_souboru, velikost_b, model) values ('vybrany', 'image/jpeg', 1, 'x')`), /permission denied/);
  await chyba(jako(V, `select opravneni.ai_zacni('jinde', 'image/jpeg', 1, 'x')`), /check/);
  await chyba(jako(V, `select opravneni.ai_zacni('vybrany', 'text/html', 1, 'x')`), /check/);
  const prvni = await zacni(V);
  assert.deepEqual([prvni.pocet, prvni.limit, prvni.limit_prekrocen], [1, 30, undefined]);
  await jako(V, `select opravneni.ai_dokonci($1, 'ok', null, 1800, 250, 0.000305, 2100)`, [prvni.id]);
  const r = (await jako(V, `select * from opravneni.ai_log where id = $1`, [prvni.id])).rows[0];
  assert.deepEqual([r.stav, r.tokeny_vstup, r.tokeny_vystup, Number(r.cena_usd), r.user_id, r.trvani_ms], ['ok', 1800, 250, 0.000305, V, 2100]);
  // dokončený řádek už nejde přepsat; stav jen ok/chyba
  await jako(V, `select opravneni.ai_dokonci($1, 'chyba', 'x', 0, 0, 0, 0)`, [prvni.id]);
  assert.equal((await jako(V, `select stav from opravneni.ai_log where id = $1`, [prvni.id])).rows[0].stav, 'ok');
  await chyba(jako(V, `select opravneni.ai_dokonci($1, 'probiha', null, 0, 0, 0, 0)`, [prvni.id]), /ok nebo chyba/);
  // včerejší volání se nepočítají; dnešní (i nedokončené a chybné) ano
  await db.exec(`insert into opravneni.ai_log (cas, user_id, zdroj, typ_souboru, velikost_b, model, stav)
    select now() - interval '2 days', '${V}', 'ulozeny', 'application/pdf', 1, 'x', 'ok' from generate_series(1, 40)`);
  for (let i = 2; i <= 30; i++) assert.equal((await zacni(V)).pocet, i);
  assert.deepEqual(await zacni(V), { limit_prekrocen: true, pocet: 30, limit: 30 });
  assert.equal((await jako(V, `select count(*)::int c from opravneni.ai_log where stav = 'probiha'`)).rows[0].c, 29);
});

test('003: rollback odebere tabulku i funkce, jde spustit znovu', async () => {
  await db.exec(readFileSync(new URL('../sql/003_rollback.sql', import.meta.url), 'utf8'));
  assert.equal((await db.query(`select to_regclass('opravneni.ai_log') t`)).rows[0].t, null);
  await chyba(jako(V, `select opravneni.ai_zacni('vybrany', 'image/jpeg', 1, 'x')`), /does not exist/);
  await db.exec(AI_LOG);
  assert.equal((await jako(V, `select opravneni.ai_zacni('vybrany', 'image/jpeg', 1, 'x') r`)).rows[0].r.pocet, 1);
});

test('002: rollback odebere funkce i anon přístup ke schématu, jde spustit znovu', async () => {
  await db.exec(UPOZORNENI_ROLLBACK);
  assert.deepEqual((await db.query(`select proname from pg_proc where pronamespace = 'opravneni'::regnamespace and proname in ('upozorneni_data','zapis_upozorneni','over_token')`)).rows, []);
  await chyba(jako('anon', `select opravneni.upozorneni_data($1)`, [TOKEN]), /permission denied|does not exist/);
  assert.equal((await db.query(`select has_schema_privilege('anon', 'opravneni', 'usage') u`)).rows[0].u, false);
  await db.exec(UPOZORNENI);
  assert.ok((await jako('anon', `select opravneni.upozorneni_data($1) d`, [TOKEN])).rows[0].d.nastaveni);
  // 002 znovu odebere práva všem funkcím ve schématu → v praxi pořadí 001, 002, 003 (ai_* pak znovu z 003)
});

test('kontroly dat', async () => {
  const mandik = o1.druh_id;
  await chyba(jako(V, `insert into opravneni.opravneni (technik_id, druh_id) values ($1, $2)`, [t1, mandik]), /check/); // bez platnosti a ne neurčitá
  await chyba(jako(V, `insert into opravneni.opravneni (technik_id, druh_id, vydano, platnost_do) values ($1, $2, '2026-05-01', '2026-04-01')`, [t1, mandik]), /check/);
  await chyba(jako(V, `insert into opravneni.druhy (kategorie, nazev) values ('ppk', 'Bez lhůty')`), /check/);
  await chyba(jako(V, `insert into opravneni.druhy (kategorie, nazev, lhuta_mesicu) values ('neexistuje', 'X', 12)`), /foreign key/);
  await chyba(jako(V, `insert into opravneni.kategorie (id, nazev) values ('vse', 'Vše')`), /check/);
  await chyba(jako(V, `insert into opravneni.kategorie (id, nazev) values ('Chlazení', 'Chlazení')`), /check/);
  await jako(V, `insert into opravneni.kategorie (id, nazev, poradi) values ('chlazeni', 'Chlazení', 5)`);
  await chyba(jako(V, `delete from opravneni.kategorie where id = 'ppk'`), /foreign key/); // má druhy
  // nejvýš jeden aktuální doklad, cesta ve složce technika, technik oprávnění s doklady nejde změnit
  await chyba(jako(V, `insert into opravneni.doklady (opravneni_id, technik_id, path) values ($1, $2, $3)`, [o1.id, t1, `${t1}/treti.pdf`]), /duplicate key/);
  await chyba(jako(V, `insert into opravneni.doklady (opravneni_id, technik_id, path, aktualni) values ($1, $2, $3, false)`, [o1.id, t1, `${t2}/cizi.pdf`]), /check/);
  await chyba(jako(V, `insert into opravneni.doklady (opravneni_id, technik_id, path, aktualni) values ($1, $2, $3, false)`, [o1.id, t2, `${t2}/x.pdf`]), /foreign key/);
  await chyba(jako(V, `update opravneni.opravneni set technik_id = $1 where id = $2`, [t2, o1.id]), /foreign key/);
  await chyba(jako(V, `delete from opravneni.technici where id = $1`, [t1]), /foreign key/); // má oprávnění → jen deaktivovat
  await chyba(jako(V, `insert into opravneni.nastaveni (id) values (2)`), /check/);
  await chyba(jako(V, `insert into opravneni.uzivatele (user_id, role) values ($1, 'technik')`, [X]), /check/); // technik bez vazby
  // smazání oprávnění smaže i záznamy dokladů
  await jako(V, `delete from opravneni.opravneni where id = $1`, [o2.id]);
  assert.equal((await jako(V, `select count(*)::int c from opravneni.doklady where opravneni_id = $1`, [o2.id])).rows[0].c, 0);
});

test('rollback vrátí vše a ostatní appky nechá; migrace jde spustit znovu', async () => {
  await chyba(db.exec(ROLLBACK), /není prázdný/); // bucket má soubory
  await db.exec(`rollback; set storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id = 'opravneni-doklady'; reset storage.allow_delete_query;`);
  await db.exec(PRISTUP_ROLLBACK);
  await db.exec(ROLLBACK);
  assert.equal((await db.query(`select count(*)::int c from pg_namespace where nspname = 'opravneni'`)).rows[0].c, 0);
  assert.deepEqual((await db.query(`select id from storage.buckets order by id`)).rows.map((r) => r.id), ['appka-a-fotky', 'appka-d-protokoly']);
  assert.deepEqual((await db.query(`select policyname from pg_policies where schemaname = 'storage' order by 1`)).rows.map((r) => r.policyname),
    ['appka_a - nahrani souboru', 'appka_d - cteni souboru']);
  assert.deepEqual((await db.query(`select aplikace from public.profily where id = '${V}'`)).rows[0].aplikace, ['appka_a', 'appka_b', 'appka_c', 'appka_d']);
  await db.exec(INIT);
  assert.equal(await pocet(V, 'opravneni.druhy'), 0); // bez 001b nemá přístup ani správce
  await db.exec(PRISTUP);
  assert.equal(await pocet(V, 'opravneni.druhy'), 13);
});
