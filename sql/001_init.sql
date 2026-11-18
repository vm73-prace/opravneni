-- 001_init.sql – Evidence oprávnění techniků ve sdíleném Supabase projektu „servisní záznamy“
-- Vlastní schéma `opravneni`; na tabulky, funkce a politiky ostatních appek sdíleného projektu nesahá.
-- Jediné změny mimo schéma: bucket `opravneni-doklady` + jeho storage politiky.
-- Přístup konkrétních účtů (profily.aplikace, role správce) je v sql/lokalni/001b_pristup.sql – mimo repo
-- (repo bude veřejné, UUID účtů do něj nepatří).
-- Podklad: skutečný výstup sql/000_pruzkum.sql (2026-11-16). Ověřeno lokálně: tests/sql.test.mjs (PGlite).
-- Běží v jedné transakci. Spouští se přes konektor Supabase jako migrace `opravneni_001_init`.
--
-- Data nejsou „po uživatelích“ (jako v kalibraci), ale společná pro firmu:
--   správce (tabulka uzivatele, role 'spravce') čte a zapisuje vše,
--   technik (role 'technik' + vazba na záznam v technici) jen ČTE svoje oprávnění a doklady a katalog.
-- Obojí navíc vyžaduje aktivní profil s 'opravneni' v profily.aplikace (opravneni.smi()).

begin;

-- ---------- Schéma ----------
create schema opravneni;
comment on schema opravneni is 'Evidence oprávnění techniků – vm73-prace/opravneni';

-- ---------- Tabulky ----------
-- Katalog: kategorie (id = kód do odkazu ?kat=) a druhy oprávnění – nic natvrdo v kódu appky.
create table opravneni.kategorie (
  id      text primary key check (id ~ '^[a-z0-9]{2,20}$' and id <> 'vse'),
  nazev   text not null check (length(btrim(nazev)) > 0),
  poradi  int  not null default 0
);

create table opravneni.druhy (
  id            uuid primary key default gen_random_uuid(),
  kategorie     text not null references opravneni.kategorie (id) on delete restrict,
  nazev         text not null check (length(btrim(nazev)) > 0),
  vydavatel     text not null default '',
  popis         text not null default '',
  lhuta_mesicu  int  check (lhuta_mesicu between 1 and 240),  -- výchozí platnost dokladu
  neurcita      boolean not null default false,               -- výchozí doba neurčitá
  predstih_dni  int  check (predstih_dni between 0 and 730),  -- null = globální z nastaveni
  vice_vyrobcu  boolean not null default false,               -- „Pokrytí výrobci“ (Švadlenka)
  aktivni       boolean not null default true,
  poradi        int  not null default 0,
  created_at    timestamptz not null default now(),
  check (neurcita or lhuta_mesicu is not null)
);

-- Technik v evidenci nemusí mít účet; účet se propojí přes opravneni.uzivatele.technik_id.
create table opravneni.technici (
  id          uuid primary key default gen_random_uuid(),
  jmeno       text not null check (length(btrim(jmeno)) > 0),
  email       text not null default '',  -- pro upozornění (prázdný = technik e-mail nedostane)
  aktivni     boolean not null default true,
  created_at  timestamptz not null default now()
);

create table opravneni.opravneni (
  id              uuid primary key default gen_random_uuid(),
  technik_id      uuid not null references opravneni.technici (id) on delete restrict,
  druh_id         uuid not null references opravneni.druhy (id) on delete restrict,
  cislo           text not null default '',
  vydavatel       text not null default '',
  vydano          date,
  platnost_do     date,
  neurcita        boolean not null default false,
  vyrobci         text[] not null default '{}',
  predstih_dni    int  check (predstih_dni between 0 and 730),  -- null = z druhu, pak globální
  objednano_na    date,                                        -- termín školení / zkoušky
  objednano_pozn  text not null default '',
  poznamka        text not null default '',
  bez_dokladu     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (neurcita or platnost_do is not null),
  check (platnost_do is null or vydano is null or platnost_do >= vydano),
  unique (id, technik_id)
);

-- Doklady (soubory) s historií: aktuální je vždy nejvýš jeden na oprávnění, starší zůstávají.
-- technik_id je kopie z oprávnění (složený cizí klíč hlídá shodu) kvůli RLS a cestě v úložišti
-- '<technik_id>/<soubor>'. Oprávnění s doklady proto nejde přepsat na jiného technika.
create table opravneni.doklady (
  id             uuid primary key default gen_random_uuid(),
  opravneni_id   uuid not null,
  technik_id     uuid not null,
  path           text not null unique check (split_part(path, '/', 1) = technik_id::text),
  typ            text not null default '',
  nazev          text not null default '',
  velikost       int  check (velikost >= 0),
  aktualni       boolean not null default true,
  nahrano        timestamptz not null default now(),
  foreign key (opravneni_id, technik_id) references opravneni.opravneni (id, technik_id) on delete cascade
);
create unique index doklady_jeden_aktualni on opravneni.doklady (opravneni_id) where aktualni;

-- Globální nastavení (jediný řádek)
create table opravneni.nastaveni (
  id            int primary key default 1 check (id = 1),
  predstih_dni  int  not null default 90 check (predstih_dni between 0 and 730),
  prijemci      text not null default '',  -- e-maily správců pro souhrn, oddělené čárkou
  vyrobci       text not null default ''   -- nabídka „Pokrytí výrobci“, oddělená čárkou
);

-- Tajné hodnoty (jediný řádek). Žádná práva pro authenticated ani anon, žádná RLS politika:
-- čte ji jen security definer RPC denní kontroly upozornění (etapa 4).
create table opravneni.tajne (
  id          int primary key default 1 check (id = 1),
  -- SHA-256 (hex) tokenu denní kontroly upozornění; samotný token je jen v GitHub Secrets
  token_hash  text check (token_hash ~ '^[0-9a-f]{64}$')
);

-- Role v appce: správce (vše) nebo technik (čte svou sekci). Přístup k appce navíc řídí profily.aplikace.
create table opravneni.uzivatele (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  role        text not null check (role in ('spravce', 'technik')),
  technik_id  uuid unique references opravneni.technici (id) on delete set null,
  check (role = 'spravce' or technik_id is not null)
);

-- Log odeslaných upozornění (kdy, komu, které položky) – diagnostika a ochrana proti duplicitám.
-- Zapisuje ho jen skript přes RPC s tokenem (etapa 4); správce ho čte.
create table opravneni.upozorneni_log (
  id         bigint generated always as identity primary key,
  cas        timestamptz not null default now(),
  typ        text not null check (typ in ('vstup', 'tydenni', 'souhrn', 'test')),
  prijemce   text not null,
  polozky    uuid[] not null default '{}',
  stav       text not null default 'ok' check (stav in ('ok', 'chyba')),
  chyba      text
);

create index druhy_kategorie_idx      on opravneni.druhy (kategorie, poradi);
create index opravneni_technik_idx    on opravneni.opravneni (technik_id);
create index opravneni_druh_idx       on opravneni.opravneni (druh_id);
create index opravneni_platnost_idx   on opravneni.opravneni (platnost_do);
create index doklady_opravneni_idx    on opravneni.doklady (opravneni_id, nahrano desc);
create index doklady_technik_idx      on opravneni.doklady (technik_id);
create index upozorneni_log_cas_idx   on opravneni.upozorneni_log (cas desc);

-- ---------- Funkce pro přístup (security definer, prázdný search_path) ----------
-- Smí uživatel do appky? Stejný vzor jako u ostatních appek projektu (<slug>.smi()).
create function opravneni.smi() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profily
    where id = (select auth.uid()) and aktivni and 'opravneni' = any(aplikace));
$$;

create function opravneni.je_spravce() returns boolean
language sql stable security definer set search_path = '' as $$
  select opravneni.smi() and exists (select 1 from opravneni.uzivatele
    where user_id = (select auth.uid()) and role = 'spravce');
$$;

-- Id technika propojeného s přihlášeným účtem (null = není technik nebo nemá přístup)
create function opravneni.muj_technik() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.technik_id from opravneni.uzivatele u
   where u.user_id = (select auth.uid()) and u.role = 'technik' and opravneni.smi();
$$;

-- Nastavení potřebné k výpočtu stavů pro každého s přístupem k appce (i technika).
-- Tabulka nastaveni je jen pro správce (obsahuje příjemce souhrnu), proto vrací jen tato dvě pole.
create function opravneni.nastaveni_vypocet() returns table (predstih_dni int, vyrobci text)
language sql stable security definer set search_path = '' as $$
  select n.predstih_dni, n.vyrobci from opravneni.nastaveni n where opravneni.smi();
$$;

-- updated_at u oprávnění
create function opravneni.nastav_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger opravneni_updated_at before update on opravneni.opravneni
  for each row execute function opravneni.nastav_updated_at();

-- ---------- RLS ----------
alter table opravneni.kategorie      enable row level security;
alter table opravneni.druhy          enable row level security;
alter table opravneni.technici       enable row level security;
alter table opravneni.opravneni      enable row level security;
alter table opravneni.doklady        enable row level security;
alter table opravneni.nastaveni      enable row level security;
alter table opravneni.tajne          enable row level security;  -- bez politik = nikdo přes API
alter table opravneni.uzivatele      enable row level security;
alter table opravneni.upozorneni_log enable row level security;

-- Správce: vše
create policy spravce on opravneni.kategorie      for all to authenticated using ((select opravneni.je_spravce())) with check ((select opravneni.je_spravce()));
create policy spravce on opravneni.druhy          for all to authenticated using ((select opravneni.je_spravce())) with check ((select opravneni.je_spravce()));
create policy spravce on opravneni.technici       for all to authenticated using ((select opravneni.je_spravce())) with check ((select opravneni.je_spravce()));
create policy spravce on opravneni.opravneni      for all to authenticated using ((select opravneni.je_spravce())) with check ((select opravneni.je_spravce()));
create policy spravce on opravneni.doklady        for all to authenticated using ((select opravneni.je_spravce())) with check ((select opravneni.je_spravce()));
create policy spravce on opravneni.nastaveni      for all to authenticated using ((select opravneni.je_spravce())) with check ((select opravneni.je_spravce()));
create policy spravce on opravneni.uzivatele      for all to authenticated using ((select opravneni.je_spravce())) with check ((select opravneni.je_spravce()));
create policy spravce on opravneni.upozorneni_log for select to authenticated using ((select opravneni.je_spravce()));

-- Technik: jen čtení – katalog, svůj záznam v technici, svoje oprávnění a doklady, svůj řádek v uzivatele
create policy technik_cte on opravneni.kategorie for select to authenticated using ((select opravneni.smi()));
create policy technik_cte on opravneni.druhy     for select to authenticated using ((select opravneni.smi()));
create policy technik_cte on opravneni.technici  for select to authenticated using (id = (select opravneni.muj_technik()));
create policy technik_cte on opravneni.opravneni for select to authenticated using (technik_id = (select opravneni.muj_technik()));
create policy technik_cte on opravneni.doklady   for select to authenticated using (technik_id = (select opravneni.muj_technik()));
create policy svuj_ucet   on opravneni.uzivatele for select to authenticated using (user_id = (select auth.uid()) and (select opravneni.smi()));

-- ---------- Práva ----------
-- Jen authenticated (dál omezuje RLS); anon nic. upozorneni_log jen čtení (zápis přes RPC v etapě 4).
-- tajne: žádná práva pro nikoho z API.
grant usage on schema opravneni to authenticated;
grant select, insert, update, delete on all tables in schema opravneni to authenticated;
revoke insert, update, delete on opravneni.upozorneni_log from authenticated;
revoke all on opravneni.tajne from public, anon, authenticated;
revoke all on all tables in schema opravneni from anon;
revoke execute on all functions in schema opravneni from public, anon, authenticated;
grant execute on function opravneni.smi(), opravneni.je_spravce(), opravneni.muj_technik(), opravneni.nastaveni_vypocet() to authenticated;

-- ---------- Úložiště ----------
-- Soukromý bucket, cesta '<technik_id>/<soubor>', otevírání jen přes podepsané URL.
-- Fotky zmenšuje appka (JPEG ~200–400 kB), PDF do 10 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('opravneni-doklady', 'opravneni-doklady', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/heic']);

create policy "opravneni - cteni dokladu" on storage.objects for select to authenticated
  using (bucket_id = 'opravneni-doklady' and ((select opravneni.je_spravce())
    or (storage.foldername(name))[1] = (select opravneni.muj_technik())::text));
create policy "opravneni - nahrani dokladu" on storage.objects for insert to authenticated
  with check (bucket_id = 'opravneni-doklady' and (select opravneni.je_spravce()));
create policy "opravneni - zmena dokladu" on storage.objects for update to authenticated
  using (bucket_id = 'opravneni-doklady' and (select opravneni.je_spravce()))
  with check (bucket_id = 'opravneni-doklady' and (select opravneni.je_spravce()));
create policy "opravneni - mazani dokladu" on storage.objects for delete to authenticated
  using (bucket_id = 'opravneni-doklady' and (select opravneni.je_spravce()));

-- ---------- Výchozí katalog (lhůty jsou orientační – skutečné doplní Vladan v Nastavení) ----------
insert into opravneni.kategorie (id, nazev, poradi) values
  ('ppk', 'PPK', 1), ('vyrobci', 'Výrobci', 2), ('fplyny', 'F-plyny', 3), ('elektro', 'Elektro', 4);

insert into opravneni.druhy (kategorie, nazev, vydavatel, popis, lhuta_mesicu, neurcita, predstih_dni, vice_vyrobcu, poradi) values
  ('ppk',     'Mandík – požární klapky',            'MANDÍK, a.s.',         'Kontrola provozuschopnosti a montáž požárních klapek Mandík', 24, false, null, false, 1),
  ('ppk',     'Systemair – požární klapky',         'Systemair a.s.',       'Kontrola provozuschopnosti požárních klapek Systemair',       24, false, null, false, 2),
  ('ppk',     'Ing. Švadlenka – PBZ více výrobců',  'Ing. Švadlenka',       'Jeden doklad pro více výrobců požárních klapek',              24, false, null, true,  3),
  ('vyrobci', 'Daikin – tepelná čerpadla',          'Daikin',               'Instalace a uvedení do provozu',                              24, false, 120,  false, 4),
  ('vyrobci', 'Daikin – VRV systémy',               'Daikin',               'Instalace a uvedení do provozu',                              24, false, 120,  false, 5),
  ('vyrobci', 'Atrea – VZT jednotky',               'ATREA s.r.o.',         'Instalace a uvedení do provozu',                              36, false, null, false, 6),
  ('fplyny',  'F-plyny – certifikát kat. I/II',     'Certifikační subjekt', 'Chlazení, klimatizace, tepelná čerpadla – stávající certifikát', null, true, null, false, 7),
  ('fplyny',  'F-plyny – certifikát dle 2024/2215', 'Certifikační subjekt', 'Nový certifikát s opakovanou zkouškou',                       60, false, null, false, 8),
  ('fplyny',  'CO₂ (R744)',                         'Certifikační subjekt', 'Certifikát pro CO₂',                                          60, false, null, false, 9),
  ('fplyny',  'Propan (R290)',                      'Certifikační subjekt', 'Certifikát pro propan – zařazení upřesnit',                   60, false, null, false, 10),
  ('elektro', '§ 6 – osoba znalá',                  'Externí zkušební subjekt', 'Samostatná činnost (NV 194/2022 Sb.)',                        60, false, null, false, 11),
  ('elektro', '§ 7 – vedoucí elektrotechnik',       'Externí zkušební subjekt', 'Řízení činnosti (NV 194/2022 Sb.)',                           60, false, null, false, 12),
  ('elektro', 'Periodické přezkoušení',             'Externí zkušební subjekt', 'Periodické školení a přezkoušení u externího subjektu, lze bez dokladu', 36, false, null, false, 13);

insert into opravneni.nastaveni (predstih_dni, vyrobci) values
  (90, 'Mandík, Systemair, Elektrodesign, IMOS, Klimaoprema, Trox');
insert into opravneni.tajne (token_hash) values (null);

-- ---------- Pojistka: žádná funkce ve schématu není spustitelná pro PUBLIC ----------
-- (`alter default privileges in schema … revoke` nefunguje, viz skill vyvoj-appky-zaklad 4a)
revoke execute on all functions in schema opravneni from public;
do $$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'opravneni'::regnamespace
             and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) then
    raise exception 'Ve schématu opravneni je funkce spustitelná pro PUBLIC';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'opravneni'::regnamespace
             and exists (select 1 from aclexplode(p.proacl) a where a.grantee = 'anon'::regrole)) then
    raise exception 'Ve schématu opravneni je funkce spustitelná pro anon';
  end if;
  if has_table_privilege('authenticated', 'opravneni.tajne', 'select') or has_table_privilege('anon', 'opravneni.tajne', 'select') then
    raise exception 'Tabulka opravneni.tajne je čitelná z API';
  end if;
end $$;

commit;

-- Ať Data API (PostgREST) hned vidí nové schéma (musí být i v Exposed schemas).
notify pgrst, 'reload schema';
