-- 002_upozorneni.sql – data a log pro denní kontrolu upozornění (GitHub Actions, scripts/upozorneni.py).
-- Skript NEPOUŽÍVÁ service_role: volá dvě security definer funkce s publishable klíčem (role anon)
-- a svým tokenem. V DB je jen SHA-256 tokenu (opravneni.tajne.token_hash, z API nečitelná); token je v GitHub Secrets.
-- Bez nastaveného token_hash obě funkce odmítnou každé volání.
-- Mimo schéma opravneni nic nemění. Spouští se přes konektor jako migrace `opravneni_002_upozorneni`.

begin;

-- anon smí do schématu jen kvůli těmto dvěma funkcím; k tabulkám dál nemá žádná práva
grant usage on schema opravneni to anon;

-- Ověření tokenu (společné pro obě funkce): shoda SHA-256 s tajne.token_hash, jinak chyba 28000
create function opravneni.over_token(token text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(token, '') = '' or not exists (
       select 1 from opravneni.tajne t
        where t.token_hash is not null
          and t.token_hash = encode(extensions.digest(token, 'sha256'), 'hex')) then
    raise exception 'neplatný token' using errcode = '28000';
  end if;
end;
$$;

-- Data pro výpočet stavů a rozeslání: jen pole, která skript potřebuje (bez dokladů a poznámek),
-- + log za posledních 400 dní (ochrana proti duplicitám: „první e-mail při vstupu do předstihu“ a „1× týdně“).
create function opravneni.upozorneni_data(token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform opravneni.over_token(token);
  return jsonb_build_object(
    'nastaveni', (select jsonb_build_object('predstih_dni', n.predstih_dni, 'prijemci', n.prijemci) from opravneni.nastaveni n where n.id = 1),
    'kategorie', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'nazev', k.nazev, 'poradi', k.poradi) order by k.poradi), '[]'::jsonb) from opravneni.kategorie k),
    'druhy', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kategorie', d.kategorie, 'nazev', d.nazev, 'predstih_dni', d.predstih_dni)), '[]'::jsonb) from opravneni.druhy d),
    'technici', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'jmeno', t.jmeno, 'email', t.email, 'aktivni', t.aktivni)), '[]'::jsonb) from opravneni.technici t),
    'opravneni', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'technik_id', o.technik_id, 'druh_id', o.druh_id, 'cislo', o.cislo,
                    'platnost_do', o.platnost_do, 'neurcita', o.neurcita, 'predstih_dni', o.predstih_dni, 'objednano_na', o.objednano_na,
                    'updated_at', o.updated_at)), '[]'::jsonb) from opravneni.opravneni o),
    'log', (select coalesce(jsonb_agg(jsonb_build_object('cas', l.cas, 'typ', l.typ, 'prijemce', l.prijemce, 'polozky', l.polozky, 'stav', l.stav) order by l.cas), '[]'::jsonb)
              from opravneni.upozorneni_log l where l.cas > now() - interval '400 days')
  );
end;
$$;

-- Zápis logu odeslání: pole záznamů [{typ, prijemce, polozky: [uuid], stav: ok|chyba, chyba}] (nejvýš 200 najednou).
-- Vrací počet zapsaných řádků. Kontroly typu a stavu hlídá tabulka (check constraints).
create function opravneni.zapis_upozorneni(token text, zaznamy jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  pocet int;
begin
  perform opravneni.over_token(token);
  if jsonb_typeof(zaznamy) is distinct from 'array' or jsonb_array_length(zaznamy) > 200 then
    raise exception 'zaznamy: čekám pole s nejvýš 200 položkami' using errcode = '22023';
  end if;
  insert into opravneni.upozorneni_log (typ, prijemce, polozky, stav, chyba)
  select z->>'typ', left(z->>'prijemce', 320),
         coalesce((select array_agg(p::uuid) from jsonb_array_elements_text(z->'polozky') p), '{}'),
         coalesce(z->>'stav', 'ok'), left(z->>'chyba', 1000)
    from jsonb_array_elements(zaznamy) z;
  get diagnostics pocet = row_count;
  return pocet;
end;
$$;

-- ---------- Práva ----------
revoke execute on all functions in schema opravneni from public, anon, authenticated;
grant execute on function opravneni.smi(), opravneni.je_spravce(), opravneni.muj_technik(), opravneni.nastaveni_vypocet() to authenticated;
grant execute on function opravneni.upozorneni_data(text), opravneni.zapis_upozorneni(text, jsonb) to anon;
-- over_token volají jen tyto dvě funkce (jako vlastník), přímo nikdo

-- ---------- Pojistka ----------
do $$
declare
  povolene_anon text[] := array['upozorneni_data', 'zapis_upozorneni'];
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'opravneni'::regnamespace
             and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) then
    raise exception 'Ve schématu opravneni je funkce spustitelná pro PUBLIC';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'opravneni'::regnamespace
             and not (p.proname = any(povolene_anon))
             and exists (select 1 from aclexplode(p.proacl) a where a.grantee = 'anon'::regrole)) then
    raise exception 'Ve schématu opravneni je pro anon spustitelná jiná funkce než upozorneni_data / zapis_upozorneni';
  end if;
  if exists (select 1 from pg_class c where c.relnamespace = 'opravneni'::regnamespace and c.relkind = 'r'
             and has_table_privilege('anon', c.oid, 'select,insert,update,delete')) then
    raise exception 'anon má právo k tabulce ve schématu opravneni';
  end if;
  if has_table_privilege('authenticated', 'opravneni.tajne', 'select') then
    raise exception 'Tabulka opravneni.tajne je čitelná z API';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
