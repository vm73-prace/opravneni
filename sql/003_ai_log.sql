-- 003_ai_log.sql – log volání AI vyčtení dokladu (Edge Function opravneni-vycteni) a denní pojistka útraty.
-- Log NEOBSAHUJE obsah dokladu ani vyčtené údaje – jen kdo, kdy, jaký soubor (typ, velikost), tokeny, cena, stav.
-- Edge Function NEPOUŽÍVÁ service_role: volá obě funkce s JWT přihlášeného správce.
--   ai_zacni   – ověří správce, spočítá dnešní volání (den podle Europe/Prague) a když je pod limitem 30,
--                založí řádek se stavem 'probiha' (zámek → dvě souběžná volání limit nepřekročí).
--   ai_dokonci – doplní výsledek do vlastního řádku (ok / chyba, kód chyby, tokeny, cena, doba).
-- Řádek, který zůstane 'probiha' (funkce spadla), se do limitu počítá – limit tím jde jen „dolů“, ne nahoru.
-- Mimo schéma opravneni nic nemění. Spouští se přes konektor jako migrace `opravneni_003_ai_log`.

begin;

create table opravneni.ai_log (
  id            bigint generated always as identity primary key,
  cas           timestamptz not null default now(),
  user_id       uuid not null default auth.uid(),
  zdroj         text not null check (zdroj in ('vybrany', 'ulozeny')),   -- soubor z formuláře / uložený doklad ze Storage
  typ_souboru   text not null check (typ_souboru in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf')),
  velikost_b    int  not null check (velikost_b >= 0),
  model         text not null,
  tokeny_vstup  int,
  tokeny_vystup int,
  cena_usd      numeric(10, 6),
  stav          text not null default 'probiha' check (stav in ('probiha', 'ok', 'chyba')),
  kod_chyby     text check (char_length(kod_chyby) <= 60),               -- např. kredit, limit_api, odmitnuto, preruseno, sit
  trvani_ms     int
);
create index ai_log_cas_idx on opravneni.ai_log (cas desc);

alter table opravneni.ai_log enable row level security;
-- správce log čte (počty a cena do interního přehledu nákladů, „dnes X / 30“); zapisovat jde jen přes funkce níže
create policy spravce on opravneni.ai_log for select to authenticated using ((select opravneni.je_spravce()));
revoke all on opravneni.ai_log from public, anon, authenticated;
grant select on opravneni.ai_log to authenticated;

-- Začátek volání: vrací {id, pocet, limit} nebo {limit_prekrocen: true, pocet, limit}
create function opravneni.ai_zacni(zdroj text, typ_souboru text, velikost_b int, model text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  limit_den constant int := 30;
  zacatek_dne timestamptz := date_trunc('day', now() at time zone 'Europe/Prague') at time zone 'Europe/Prague';
  pocet int;
  nove_id bigint;
begin
  if not opravneni.je_spravce() then
    raise exception 'jen správce' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('opravneni.ai_log'));
  select count(*) into pocet from opravneni.ai_log l where l.cas >= zacatek_dne;
  if pocet >= limit_den then
    return jsonb_build_object('limit_prekrocen', true, 'pocet', pocet, 'limit', limit_den);
  end if;
  insert into opravneni.ai_log (zdroj, typ_souboru, velikost_b, model)
  values (ai_zacni.zdroj, ai_zacni.typ_souboru, ai_zacni.velikost_b, left(ai_zacni.model, 60))
  returning id into nove_id;
  return jsonb_build_object('id', nove_id, 'pocet', pocet + 1, 'limit', limit_den);
end;
$$;

-- Konec volání: jen vlastní řádek ve stavu 'probiha'
create function opravneni.ai_dokonci(id bigint, stav text, kod_chyby text, tokeny_vstup int, tokeny_vystup int, cena_usd numeric, trvani_ms int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not opravneni.je_spravce() then
    raise exception 'jen správce' using errcode = '42501';
  end if;
  if ai_dokonci.stav not in ('ok', 'chyba') then
    raise exception 'stav: ok nebo chyba' using errcode = '22023';
  end if;
  update opravneni.ai_log l
     set stav = ai_dokonci.stav, kod_chyby = left(ai_dokonci.kod_chyby, 60),
         tokeny_vstup = ai_dokonci.tokeny_vstup, tokeny_vystup = ai_dokonci.tokeny_vystup,
         cena_usd = ai_dokonci.cena_usd, trvani_ms = ai_dokonci.trvani_ms
   where l.id = ai_dokonci.id and l.user_id = (select auth.uid()) and l.stav = 'probiha';
end;
$$;

-- ---------- Práva ----------
revoke execute on function opravneni.ai_zacni(text, text, int, text) from public, anon, authenticated;
revoke execute on function opravneni.ai_dokonci(bigint, text, text, int, int, numeric, int) from public, anon, authenticated;
grant execute on function opravneni.ai_zacni(text, text, int, text), opravneni.ai_dokonci(bigint, text, text, int, int, numeric, int) to authenticated;

-- ---------- Pojistka ----------
do $$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'opravneni'::regnamespace
             and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) then
    raise exception 'Ve schématu opravneni je funkce spustitelná pro PUBLIC';
  end if;
  if has_function_privilege('anon', 'opravneni.ai_zacni(text, text, int, text)', 'execute')
     or has_function_privilege('anon', 'opravneni.ai_dokonci(bigint, text, text, int, int, numeric, int)', 'execute') then
    raise exception 'anon smí spustit funkci ai_*';
  end if;
  if has_table_privilege('anon', 'opravneni.ai_log', 'select')
     or has_table_privilege('authenticated', 'opravneni.ai_log', 'insert')
     or has_table_privilege('authenticated', 'opravneni.ai_log', 'update')
     or has_table_privilege('authenticated', 'opravneni.ai_log', 'delete') then
    raise exception 'ai_log má širší práva, než má mít';
  end if;
end;
$$;

commit;
notify pgrst, 'reload schema';
